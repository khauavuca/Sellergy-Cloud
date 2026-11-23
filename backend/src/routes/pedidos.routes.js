// Pedidos do catalogo online e venda pelo WhatsApp.
// Montado em /pedidos (src/index.js). Frente B da fase 2.
//
//   GET  /pedidos                   -> quadro (abertos + entregues/cancelados dos ultimos 7 dias)
//   GET  /pedidos/loja              -> configuracao da loja online + link
//   PUT  /pedidos/loja              -> liga/desliga e configura (dono/administrador)
//   GET  /pedidos/produtos?busca=   -> produtos pra montar pedido na mao
//   GET  /pedidos/clientes?busca=   -> clientes (leads) pra montar pedido na mao
//   POST /pedidos                   -> "Vender pelo WhatsApp": cria (origem WHATSAPP) e manda a cobranca
//   GET  /pedidos/:id               -> detalhe
//   POST /pedidos/:id/aceitar       -> cria a cobranca (Pix/link) e manda no WhatsApp
//   POST /pedidos/:id/reenviar      -> manda a cobranca de novo (gera outra se a anterior caiu)
//   POST /pedidos/:id/pago          -> marcar como pago na mao (dinheiro na retirada) -> registra a venda
//   POST /pedidos/:id/entregar      -> entregue / retirado
//   POST /pedidos/:id/cancelar      -> cancela (so antes de pagar)
//
// Gating: modulo VENDAS + recurso de plano catalogoOnline + permissao de VENDAS.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  requerTenant, requerModuloLiberado, requerPermissao, requerPapelPrivilegiado,
} = require('../middlewares/permissoes.middleware');
const { exigirRecurso } = require('../planos/recursos');
const {
  criarPedido, aceitarECobrar, marcarComoPago, entregar, cancelar, pedidoDoTenant, baseUrlPublica,
} = require('../pedidos/pedidoService');
const { ErroPedido, nomeDaVariacao, STATUS, linkPedido } = require('../pedidos/regras');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerTenant);
roteador.use((req, res, next) => (req.usuario?.clienteId ? next() : res.status(403).json({ erro: 'Acesso negado: usuario sem tenant.' })));
roteador.use(requerModuloLiberado('VENDAS'));
roteador.use(exigirRecurso('catalogoOnline'));

const UUID = /^[0-9a-f-]{36}$/i;
const DIAS_HISTORICO = 7;

function responderErro(res, e, contexto) {
  if (e instanceof ErroPedido) {
    return res.status(e.status).json({ erro: e.message, codigo: e.codigo, campos: e.campos, semEstoque: e.semEstoque });
  }
  if (e?.status && e?.message) {
    // Erro do PSP/configuracao de pagamento (pagamentoService).
    const msg = e.codigo === 'PAGAMENTO_NAO_CONFIGURADO'
      ? 'Conecte uma forma de receber (Conta de recebimento ou Pagamentos) antes de mandar o Pix.'
      : e.codigo === 'PAGADOR_SEM_CPF'
        ? 'Para cobrar pelo Asaas, o cadastro do cliente precisa ter CPF.'
        : e.codigo === 'PSP_ERRO'
          ? 'O provedor de pagamento recusou a cobrança. Confira a conta conectada em Pagamentos.'
          : e.message;
    return res.status(e.status >= 500 ? 502 : e.status).json({ erro: msg, codigo: e.codigo });
  }
  console.error(`[pedidos/${contexto}]`, e);
  return res.status(500).json({ erro: 'Erro ao processar o pedido.' });
}

const CAMPOS_LISTA = {
  id: true, numero: true, nomeCliente: true, telefone: true, itens: true, subtotal: true, frete: true, total: true,
  entrega: true, origem: true, status: true, criadoEm: true, pagoEm: true, entregueEm: true, canceladoEm: true,
};

// ---------------------------------------------------------------------
// Quadro
// ---------------------------------------------------------------------
roteador.get('/', requerPermissao('VENDAS', 'visualizar'), async (req, res) => {
  try {
    const desde = new Date(Date.now() - DIAS_HISTORICO * 86400000);
    const pedidos = await prisma.pedido.findMany({
      where: {
        clienteId: req.usuario.clienteId,
        OR: [
          { status: { in: [STATUS.NOVO, STATUS.AGUARDANDO_PAGAMENTO, STATUS.PAGO] } },
          { status: { in: [STATUS.ENTREGUE, STATUS.CANCELADO] }, atualizadoEm: { gte: desde } },
        ],
      },
      select: CAMPOS_LISTA,
      orderBy: { criadoEm: 'desc' },
      take: 300,
    });
    res.json({ pedidos, diasHistorico: DIAS_HISTORICO });
  } catch (e) {
    responderErro(res, e, 'listar');
  }
});

// ---------------------------------------------------------------------
// Loja online (configuracao)
// ---------------------------------------------------------------------
async function lerLoja(clienteId) {
  const [cliente, config, pagamento] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { slugPublico: true } }),
    prisma.configuracaoCatalogo.findUnique({ where: { clienteId } }),
    prisma.configuracaoPagamento.findUnique({ where: { clienteId }, select: { provedor: true, ativo: true } }),
  ]);
  const slug = cliente?.slugPublico || null;
  return {
    online: config?.online === true,
    aceitaRetirada: config ? config.aceitaRetirada : true,
    aceitaEntrega: config ? config.aceitaEntrega : false,
    freteEntrega: config?.freteEntrega ?? null,
    pedidoMinimo: config?.pedidoMinimo ?? null,
    ocultarSemEstoque: config ? config.ocultarSemEstoque : true,
    slug,
    link: slug ? `${baseUrlPublica()}/loja/${slug}` : null,
    pagamentoConectado: pagamento?.ativo === true,
    provedorPagamento: pagamento?.ativo ? pagamento.provedor : null,
  };
}

roteador.get('/loja', requerPermissao('VENDAS', 'visualizar'), async (req, res) => {
  try {
    res.json(await lerLoja(req.usuario.clienteId));
  } catch (e) {
    responderErro(res, e, 'loja');
  }
});

function lerValor(v, campo, campos) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000) { campos.push(campo); return null; }
  return Math.round(n * 100) / 100;
}

roteador.put('/loja', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const b = req.body || {};
    const campos = [];
    const data = {};
    for (const k of ['online', 'aceitaRetirada', 'aceitaEntrega', 'ocultarSemEstoque']) {
      if (b[k] !== undefined) {
        if (typeof b[k] !== 'boolean') campos.push(k);
        else data[k] = b[k];
      }
    }
    if (b.freteEntrega !== undefined) data.freteEntrega = lerValor(b.freteEntrega, 'freteEntrega', campos);
    if (b.pedidoMinimo !== undefined) data.pedidoMinimo = lerValor(b.pedidoMinimo, 'pedidoMinimo', campos);
    if (campos.length) return res.status(422).json({ erro: 'Confira os campos destacados.', campos });

    const atual = await prisma.configuracaoCatalogo.findUnique({ where: { clienteId } });
    const final = {
      online: data.online ?? atual?.online ?? false,
      aceitaRetirada: data.aceitaRetirada ?? atual?.aceitaRetirada ?? true,
      aceitaEntrega: data.aceitaEntrega ?? atual?.aceitaEntrega ?? false,
    };
    if (!final.aceitaRetirada && !final.aceitaEntrega) {
      return res.status(422).json({ erro: 'Escolha pelo menos uma forma de entrega: retirada ou entrega.', campos: ['aceitaRetirada', 'aceitaEntrega'] });
    }
    if (final.online) {
      const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { slugPublico: true } });
      if (!cliente?.slugPublico) {
        return res.status(422).json({ erro: 'Escolha o endereço da loja antes de colocar no ar.', campos: ['slug'] });
      }
    }
    await prisma.configuracaoCatalogo.upsert({ where: { clienteId }, create: { clienteId, ...data }, update: data });
    res.json(await lerLoja(clienteId));
  } catch (e) {
    responderErro(res, e, 'loja-salvar');
  }
});

// ---------------------------------------------------------------------
// Apoio pra montar pedido na mao
// ---------------------------------------------------------------------
roteador.get('/produtos', requerPermissao('VENDAS', 'criar'), async (req, res) => {
  try {
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 60) : '';
    const variacoes = await prisma.variacaoProduto.findMany({
      where: {
        produto: {
          clienteId: req.usuario.clienteId, tipo: 'FISICO', visibilidade: 'ATIVO',
          ...(busca ? { nome: { contains: busca, mode: 'insensitive' } } : {}),
        },
        preco: { gt: 0 },
      },
      select: { id: true, nome: true, preco: true, estoqueAtual: true, produto: { select: { id: true, nome: true, imagemUrl: true } } },
      orderBy: [{ produto: { nome: 'asc' } }, { preco: 'asc' }],
      take: 50,
    });
    res.json(variacoes.map((v) => ({
      variacaoId: v.id, nome: nomeDaVariacao(v), preco: v.preco, estoque: v.estoqueAtual, imagemUrl: v.produto.imagemUrl || null,
    })));
  } catch (e) {
    responderErro(res, e, 'produtos');
  }
});

roteador.get('/clientes', requerPermissao('VENDAS', 'criar'), async (req, res) => {
  try {
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 60) : '';
    if (busca.length < 2) return res.json([]);
    const digitos = busca.replace(/\D/g, '');
    const leads = await prisma.lead.findMany({
      where: {
        clienteId: req.usuario.clienteId,
        OR: [
          { nome: { contains: busca, mode: 'insensitive' } },
          ...(digitos.length >= 4 ? [{ telefone: { contains: digitos } }] : []),
        ],
      },
      select: { id: true, nome: true, telefone: true, cpf: true },
      orderBy: { atualizadoEm: 'desc' },
      take: 10,
    });
    res.json(leads.map((l) => ({ id: l.id, nome: l.nome, telefone: l.telefone, temCpf: Boolean(l.cpf) })));
  } catch (e) {
    responderErro(res, e, 'clientes');
  }
});

// POST /pedidos — Vender pelo WhatsApp: monta o pedido e ja manda a cobranca.
roteador.post('/', requerPermissao('VENDAS', 'criar'), async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const b = req.body || {};
    let { nome, telefone } = b;
    // Cliente escolhido da lista: nome/telefone/CPF vem do cadastro.
    let cpf = b.cpf;
    if (b.leadId) {
      if (typeof b.leadId !== 'string' || !UUID.test(b.leadId)) return res.status(422).json({ erro: 'Cliente inválido.', campos: ['leadId'] });
      const lead = await prisma.lead.findFirst({ where: { id: b.leadId, clienteId }, select: { nome: true, telefone: true, cpf: true } });
      if (!lead) return res.status(422).json({ erro: 'Cliente não encontrado.', campos: ['leadId'] });
      nome = nome || lead.nome;
      telefone = telefone || lead.telefone || '';
      cpf = cpf || lead.cpf || undefined;
    }
    const config = await prisma.configuracaoCatalogo.findUnique({ where: { clienteId } });
    const pagamento = await prisma.configuracaoPagamento.findUnique({ where: { clienteId }, select: { provedor: true, ativo: true } });
    if (!pagamento?.ativo) {
      return res.status(409).json({ erro: 'Conecte uma forma de receber (Conta de recebimento ou Pagamentos) antes de vender pelo WhatsApp.', codigo: 'PAGAMENTO_NAO_CONFIGURADO' });
    }
    const pedido = await criarPedido({
      clienteId,
      origem: 'WHATSAPP',
      entrada: { itens: b.itens, entrega: b.entrega, endereco: b.endereco, nome, telefone, cpf, observacao: b.observacao },
      config: config || {},
      exigeCpf: pagamento.provedor === 'ASAAS',
      freteManual: b.frete === undefined || b.frete === null || b.frete === '' ? null : Number(b.frete),
    });
    try {
      const r = await aceitarECobrar(pedido, { metodo: b.metodo === 'LINK' ? 'LINK' : 'PIX' });
      res.status(201).json({ pedido: r.pedido, mensagem: r.mensagem, whatsapp: r.whatsapp, link: linkPedido(baseUrlPublica(), r.pedido.tokenPublico) });
    } catch (errCobranca) {
      // O pedido ficou criado como NOVO: aparece no quadro pra tentar de novo.
      if (errCobranca instanceof ErroPedido || errCobranca?.status) {
        const status = errCobranca.status >= 500 ? 502 : errCobranca.status;
        return res.status(status).json({
          erro: `Pedido #${pedido.numero} criado, mas a cobrança não saiu: ${errCobranca.message}`,
          codigo: errCobranca.codigo || 'COBRANCA_FALHOU',
          pedidoId: pedido.id,
        });
      }
      throw errCobranca;
    }
  } catch (e) {
    responderErro(res, e, 'criar');
  }
});

// ---------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------
async function carregar(req, res) {
  const pedido = await pedidoDoTenant(req.usuario.clienteId, req.params.id);
  if (!pedido) {
    res.status(404).json({ erro: 'Pedido não encontrado.' });
    return null;
  }
  return pedido;
}

roteador.get('/:id', requerPermissao('VENDAS', 'visualizar'), async (req, res) => {
  try {
    const pedido = await carregar(req, res);
    if (!pedido) return;
    const [cobranca, venda] = await Promise.all([
      pedido.cobrancaId
        ? prisma.cobranca.findFirst({
          where: { id: pedido.cobrancaId, clienteId: pedido.clienteId },
          select: { id: true, status: true, metodo: true, valor: true, qrCode: true, linkUrl: true, criadoEm: true, pagoEm: true, provedor: true },
        })
        : null,
      pedido.vendaId
        ? prisma.venda.findFirst({ where: { id: pedido.vendaId, clienteId: pedido.clienteId }, select: { id: true, numero: true, metodoPagamento: true } })
        : null,
    ]);
    // eslint-disable-next-line no-unused-vars
    const { tokenPublico, ...resto } = pedido;
    res.json({ ...resto, linkPublico: linkPedido(baseUrlPublica(), tokenPublico), cobranca, venda });
  } catch (e) {
    responderErro(res, e, 'detalhe');
  }
});

roteador.post('/:id/aceitar', requerPermissao('VENDAS', 'editar'), async (req, res) => {
  try {
    const pedido = await carregar(req, res);
    if (!pedido) return;
    if (pedido.status !== STATUS.NOVO) return res.status(409).json({ erro: 'Esse pedido já foi aceito.', codigo: 'TRANSICAO_INVALIDA' });
    const r = await aceitarECobrar(pedido, { metodo: req.body?.metodo === 'LINK' ? 'LINK' : 'PIX' });
    res.json({ pedido: r.pedido, mensagem: r.mensagem, whatsapp: r.whatsapp });
  } catch (e) {
    responderErro(res, e, 'aceitar');
  }
});

roteador.post('/:id/reenviar', requerPermissao('VENDAS', 'editar'), async (req, res) => {
  try {
    const pedido = await carregar(req, res);
    if (!pedido) return;
    if (pedido.status !== STATUS.AGUARDANDO_PAGAMENTO) return res.status(409).json({ erro: 'Esse pedido não está esperando pagamento.', codigo: 'TRANSICAO_INVALIDA' });
    const r = await aceitarECobrar(pedido, { metodo: req.body?.metodo === 'LINK' ? 'LINK' : 'PIX' });
    res.json({ pedido: r.pedido, mensagem: r.mensagem, whatsapp: r.whatsapp });
  } catch (e) {
    responderErro(res, e, 'reenviar');
  }
});

roteador.post('/:id/pago', requerPermissao('VENDAS', 'editar'), async (req, res) => {
  try {
    const pedido = await carregar(req, res);
    if (!pedido) return;
    const r = await marcarComoPago(pedido, { metodoPagamento: String(req.body?.metodoPagamento || 'DINHEIRO').toUpperCase() });
    res.json({ pedido: r.pedido, venda: { id: r.venda.id, numero: r.venda.numero }, estoqueInsuficiente: r.estoqueInsuficiente });
  } catch (e) {
    responderErro(res, e, 'pago');
  }
});

roteador.post('/:id/entregar', requerPermissao('VENDAS', 'editar'), async (req, res) => {
  try {
    const pedido = await carregar(req, res);
    if (!pedido) return;
    res.json({ pedido: await entregar(pedido) });
  } catch (e) {
    responderErro(res, e, 'entregar');
  }
});

roteador.post('/:id/cancelar', requerPermissao('VENDAS', 'editar'), async (req, res) => {
  try {
    const pedido = await carregar(req, res);
    if (!pedido) return;
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim().slice(0, 200) : '';
    res.json({ pedido: await cancelar(pedido, { motivo: motivo || null }) });
  } catch (e) {
    responderErro(res, e, 'cancelar');
  }
});

module.exports = roteador;

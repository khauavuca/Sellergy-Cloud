// Catalogo online publico (/loja/:slug) e acompanhamento do pedido.
// Montado em /publico/loja (src/index.js). Frente B da fase 2.
//
//   GET  /publico/loja/:slug            -> vitrine (negocio, entrega, categorias, produtos)
//   POST /publico/loja/:slug/pedidos    -> cria o pedido { itens:[{variacaoId, quantidade}], entrega, endereco?, nome, telefone, cpf?, observacao? }
//   GET  /publico/loja/pedido/:token    -> acompanhamento do pedido (link que vai no WhatsApp)
//
// Seguranca:
//   - sem sessao (isento de CSRF como o resto de /publico);
//   - a loja some (404) se o catalogo online estiver desligado, se o plano nao
//     tiver `catalogoOnline` ou se a conta estiver suspensa/sem operar;
//   - preco, frete e total SEMPRE recalculados no servidor (pedidos/regras.js);
//   - estoque conferido no pedido (dentro da transacao com lock);
//   - token do pedido aleatorio (18 bytes), sem enumerar;
//   - limite de requisicoes proprio, mais apertado na escrita.

const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const prisma = require('../prisma');
const { temRecurso } = require('../planos/recursos');
const { situacaoAssinatura } = require('../assinatura/situacao');
const { criarPedido, aposPedidoDaLoja } = require('../pedidos/pedidoService');
const { ErroPedido, nomeDaVariacao } = require('../pedidos/regras');

const roteador = express.Router();

const limitadorLeitura = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const limitadorEscrita = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitos pedidos seguidos. Tente de novo mais tarde.' },
});

const LIMITE_QTD_VITRINE = 20;

/** Negocio com a loja online no ar (ou null). */
async function lojaOnline(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  const cliente = await prisma.cliente.findUnique({
    where: { slugPublico: slug },
    select: {
      id: true, nome: true, brandNome: true, brandLogo: true, status: true,
      plano: true, statusAssinatura: true, trialAte: true, modulosLiberados: true,
      configuracaoCatalogo: true,
      configuracaoPagamento: { select: { provedor: true, ativo: true } },
    },
  });
  if (!cliente || cliente.status !== 'ACTIVE') return null;
  if (!situacaoAssinatura(cliente).podeOperar) return null;
  if (!temRecurso(cliente, 'catalogoOnline')) return null;
  if (cliente.modulosLiberados?.VENDAS !== true) return null;
  const config = cliente.configuracaoCatalogo;
  if (!config?.online) return null;
  if (!config.aceitaRetirada && !config.aceitaEntrega) return null;
  return { cliente, config };
}

const indisponivel = (res) => res.status(404).json({ erro: 'Loja online indisponível neste endereço.', codigo: 'LOJA_INDISPONIVEL' });

/** So digitos, com DDI 55 quando vier so DDD + numero. null se nao parece telefone. */
function paraWaMe(texto) {
  let d = String(texto || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 13 ? d : null;
}

/**
 * Numero de WhatsApp que recebe o pedido: o conectado na tela Bots (QR Code
 * ou oficial confirmado); sem bot conectado, o telefone do cadastro.
 */
async function whatsappDoNegocio(clienteId) {
  const bots = await prisma.bot.findMany({
    where: { clienteId },
    select: { provedorCanal: true, statusConexaoBaileys: true, baileysNumeroConectado: true, oficialNumeroExibicao: true, webhookConfirmadoEm: true },
    orderBy: { criadoEm: 'asc' },
  });
  for (const b of bots) {
    if (b.provedorCanal === 'BAILEYS' && b.statusConexaoBaileys === 'CONECTADO' && paraWaMe(b.baileysNumeroConectado)) return paraWaMe(b.baileysNumeroConectado);
    if (b.provedorCanal === 'META_CLOUD' && b.webhookConfirmadoEm && paraWaMe(String(b.oficialNumeroExibicao || '').split('·')[0])) {
      return paraWaMe(String(b.oficialNumeroExibicao).split('·')[0]);
    }
  }
  const c = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { telefone: true } });
  return paraWaMe(c?.telefone);
}

const brl = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

/** Mensagem que o cliente manda pro negocio depois de fechar o pedido. */
function mensagemDoPedido(pedido) {
  const itens = (Array.isArray(pedido.itens) ? pedido.itens : [])
    .map((i) => `• ${i.quantidade}x ${i.nome} — ${brl(i.subtotal ?? (i.precoUnitario * i.quantidade))}`);
  const receber = pedido.entrega === 'ENTREGA' ? 'entrega' : 'retirada na loja';
  return [`Olá! Acabei de fazer o pedido #${pedido.numero} pelo catálogo:`, ...itens, `Total: ${brl(pedido.total)} (${receber})`].join('\n');
}

/** O Asaas cobra com CPF de quem paga: a loja pede o CPF so nesse caso. */
function exigeCpf(cliente) {
  return cliente.configuracaoPagamento?.ativo === true && cliente.configuracaoPagamento.provedor === 'ASAAS';
}

roteador.get('/pedido/:token', limitadorLeitura, async (req, res) => {
  try {
    const token = req.params.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    const pedido = await prisma.pedido.findUnique({
      where: { tokenPublico: token },
      select: {
        id: true, clienteId: true, numero: true, nomeCliente: true, itens: true, subtotal: true, frete: true, total: true,
        entrega: true, endereco: true, status: true, cobrancaId: true, linkPagamento: true,
        criadoEm: true, pagoEm: true, entregueEm: true, canceladoEm: true,
      },
    });
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    const negocio = await prisma.cliente.findUnique({
      where: { id: pedido.clienteId },
      select: { nome: true, brandNome: true, brandLogo: true, slugPublico: true },
    });

    let pagamento = null;
    if (pedido.status === 'AGUARDANDO_PAGAMENTO' && pedido.cobrancaId) {
      const cob = await prisma.cobranca.findFirst({
        where: { id: pedido.cobrancaId, clienteId: pedido.clienteId },
        select: { status: true, metodo: true, qrCode: true, linkUrl: true, vencimento: true },
      });
      if (cob && cob.status === 'PENDENTE') {
        pagamento = {
          metodo: cob.metodo,
          pixCopiaECola: cob.qrCode || null,
          qrCodeImagem: cob.qrCode ? await QRCode.toDataURL(cob.qrCode, { margin: 1, width: 280 }).catch(() => null) : null,
          link: cob.linkUrl || pedido.linkPagamento || null,
          vencimento: cob.vencimento,
        };
      }
    }

    // Botao "mandar no WhatsApp da loja" (mensagem pronta com o pedido).
    const numeroZap = pedido.status === 'CANCELADO' ? null : await whatsappDoNegocio(pedido.clienteId).catch(() => null);
    res.json({
      negocio: {
        nome: negocio?.brandNome || negocio?.nome || '', logo: negocio?.brandLogo || null, slug: negocio?.slugPublico || null,
        whatsappUrl: numeroZap ? `https://wa.me/${numeroZap}?text=${encodeURIComponent(mensagemDoPedido(pedido))}` : null,
      },
      pedido: {
        numero: pedido.numero,
        primeiroNome: String(pedido.nomeCliente || '').trim().split(/\s+/)[0],
        itens: (Array.isArray(pedido.itens) ? pedido.itens : []).map((i) => ({
          nome: i.nome, quantidade: i.quantidade, precoUnitario: i.precoUnitario, subtotal: i.subtotal,
        })),
        subtotal: pedido.subtotal,
        frete: pedido.frete,
        total: pedido.total,
        entrega: pedido.entrega,
        endereco: pedido.endereco,
        status: pedido.status,
        criadoEm: pedido.criadoEm,
        pagoEm: pedido.pagoEm,
        entregueEm: pedido.entregueEm,
        canceladoEm: pedido.canceladoEm,
      },
      pagamento,
    });
  } catch (e) {
    console.error('[publico/loja/pedido]', e);
    res.status(500).json({ erro: 'Erro ao carregar o pedido.' });
  }
});

roteador.get('/:slug', limitadorLeitura, async (req, res) => {
  try {
    const loja = await lojaOnline(req.params.slug);
    if (!loja) return indisponivel(res);
    const { cliente, config } = loja;

    const produtos = await prisma.produto.findMany({
      where: { clienteId: cliente.id, tipo: 'FISICO', visibilidade: 'ATIVO' },
      select: {
        id: true, nome: true, descricao: true, imagemUrl: true,
        categoria: { select: { nome: true } },
        variacoes: { select: { id: true, nome: true, preco: true, estoqueAtual: true, imagemUrl: true }, orderBy: { preco: 'asc' } },
      },
      orderBy: { nome: 'asc' },
    });

    const vitrine = [];
    for (const p of produtos) {
      const variacoes = p.variacoes
        .filter((v) => typeof v.preco === 'number' && v.preco > 0)
        .filter((v) => !config.ocultarSemEstoque || v.estoqueAtual > 0)
        .map((v) => ({
          id: v.id,
          nome: nomeDaVariacao({ ...v, produto: p }),
          rotulo: v.nome,
          preco: v.preco,
          disponivel: v.estoqueAtual > 0,
          // So o teto da quantidade (nao o estoque exato acima disso).
          maximo: Math.max(0, Math.min(v.estoqueAtual, LIMITE_QTD_VITRINE)),
          imagemUrl: v.imagemUrl || null,
        }));
      if (!variacoes.length) continue;
      vitrine.push({
        id: p.id,
        nome: p.nome,
        descricao: config.mostrarDescricao ? p.descricao || null : null,
        categoria: p.categoria?.nome || 'Outros',
        imagemUrl: config.mostrarFoto ? p.imagemUrl || null : null,
        variacoes: config.mostrarFoto ? variacoes : variacoes.map((v) => ({ ...v, imagemUrl: null })),
      });
    }
    const categorias = [...new Set(vitrine.map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    res.json({
      negocio: {
        nome: cliente.brandNome || cliente.nome, logo: cliente.brandLogo || null, corDestaque: config.corDestaque || null,
        temWhatsapp: Boolean(await whatsappDoNegocio(cliente.id)),
      },
      entrega: {
        aceitaRetirada: config.aceitaRetirada,
        aceitaEntrega: config.aceitaEntrega,
        freteEntrega: config.aceitaEntrega ? Number(config.freteEntrega) || 0 : null,
        pedidoMinimo: Number(config.pedidoMinimo) > 0 ? Number(config.pedidoMinimo) : null,
      },
      pedeCpf: exigeCpf(cliente),
      categorias,
      produtos: vitrine,
    });
  } catch (e) {
    console.error('[publico/loja]', e);
    res.status(500).json({ erro: 'Erro ao carregar a loja.' });
  }
});

roteador.post('/:slug/pedidos', limitadorEscrita, async (req, res) => {
  try {
    const loja = await lojaOnline(req.params.slug);
    if (!loja) return indisponivel(res);
    const corpo = req.body || {};
    const pedido = await criarPedido({
      clienteId: loja.cliente.id,
      origem: 'CATALOGO',
      entrada: {
        itens: corpo.itens, entrega: corpo.entrega, endereco: corpo.endereco,
        nome: corpo.nome, telefone: corpo.telefone, cpf: corpo.cpf, observacao: corpo.observacao,
      },
      config: loja.config,
      exigeCpf: exigeCpf(loja.cliente),
    });
    // Avisos fora da resposta critica: falha no WhatsApp nao derruba o pedido.
    await aposPedidoDaLoja(pedido).catch((e) => console.error('[publico/loja] avisos do pedido', e?.message));
    // Depois do pedido o cliente manda no WhatsApp do negocio, com a mensagem pronta.
    const numero = await whatsappDoNegocio(loja.cliente.id).catch(() => null);
    const whatsappUrl = numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagemDoPedido(pedido))}` : null;
    res.status(201).json({ token: pedido.tokenPublico, numero: pedido.numero, total: pedido.total, whatsappUrl, mensagem: mensagemDoPedido(pedido) });
  } catch (e) {
    if (e instanceof ErroPedido) {
      return res.status(e.status).json({ erro: e.message, codigo: e.codigo, campos: e.campos, semEstoque: e.semEstoque });
    }
    console.error('[publico/loja/pedidos]', e);
    res.status(500).json({ erro: 'Erro ao enviar o pedido. Tente de novo.' });
  }
});

module.exports = roteador;
module.exports._internos = { paraWaMe, mensagemDoPedido };

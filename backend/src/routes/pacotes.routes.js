// Pacotes de sessoes: modelos, venda, saldo, uso.
// Montado em /pacotes (src/index.js). Frente A da fase 2.
//
//   GET    /pacotes/modelos                     -> modelos + quantas clientes ativas
//   POST   /pacotes/modelos                     -> cria (servico, sessoes, preco, validade)
//   PUT    /pacotes/modelos/:id                 -> edita
//   DELETE /pacotes/modelos/:id                 -> desativa (quem ja comprou continua usando)
//   GET    /pacotes/clientes?filtro=acabando    -> clientes com pacote
//   POST   /pacotes/vender                      -> vende (caixa agora ou Pix parcelado)
//   POST   /pacotes/clientes/:id/reenviar-pix   -> manda de novo o Pix da parcela aberta
//   POST   /pacotes/clientes/:id/cancelar       -> cancela o pacote (cobrancas abertas caem)
// Exige o recurso de plano 'pacotes'. Regra em src/agenda/pacotes.js.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const {
  requerTenant, requerModuloLiberado, requerPermissao, requerPapelPrivilegiado,
} = require('../middlewares/permissoes.middleware');
const { exigirRecurso } = require('../planos/recursos');
const { lockClienteAdvisory } = require('../utils/locks');
const { obterOuAbrirSessaoCaixa } = require('../services/caixaAutomatico');
const { criarVenda } = require('../services/vendaService');
const pacotes = require('../agenda/pacotes');
const { pagamentoConfigurado } = require('../agenda/sinal');
const { reconciliarEstornos } = require('../agenda/eventosAgenda');
const { mesmoTelefone, digitos, round2, brl } = require('../agenda/utilAgenda');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerTenant);
roteador.use(requerModuloLiberado('AGENDA'));
roteador.use(exigirRecurso('pacotes'));

const METODOS_CAIXA = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO'];

function clienteDe(req, res) {
  const id = req.usuario?.clienteId;
  if (!id) res.status(403).json({ erro: 'Escolha um negócio para ver os pacotes.' });
  return id;
}

function responderErro(res, e, contexto) {
  if (e?.status) return res.status(e.status).json({ erro: e.message, campos: e.campos, codigo: e.codigo });
  console.error(`[pacotes/${contexto}]`, e);
  return res.status(500).json({ erro: 'Erro nos pacotes. Tente de novo.' });
}

function falha(status, erro, campos) {
  return Object.assign(new Error(erro), { status, campos });
}

/** Valida o corpo de criar/editar modelo. parcial=true no PUT. */
async function lerModelo(clienteId, body, { parcial = false } = {}) {
  const data = {};
  const campos = [];
  if (!parcial || body.nome !== undefined) {
    const nome = typeof body.nome === 'string' ? body.nome.trim().slice(0, 80) : '';
    if (nome.length < 2) campos.push('nome'); else data.nome = nome;
  }
  if (!parcial || body.produtoId !== undefined) {
    const produto = typeof body.produtoId === 'string'
      ? await prisma.produto.findFirst({ where: { id: body.produtoId, clienteId, tipo: 'SERVICO' }, select: { id: true, nome: true } })
      : null;
    if (!produto) campos.push('produtoId'); else { data.produtoId = produto.id; data.servico = produto.nome; }
  }
  if (!parcial || body.sessoes !== undefined) {
    const n = Number(body.sessoes);
    if (!Number.isInteger(n) || n < 2 || n > 100) campos.push('sessoes'); else data.sessoes = n;
  }
  if (!parcial || body.preco !== undefined) {
    const n = Number(body.preco);
    if (!Number.isFinite(n) || n <= 0 || n > 1000000) campos.push('preco'); else data.preco = round2(n);
  }
  if (!parcial || body.validadeDias !== undefined) {
    const n = body.validadeDias === undefined || body.validadeDias === '' ? 180 : Number(body.validadeDias);
    if (!Number.isInteger(n) || n < 7 || n > 1095) campos.push('validadeDias'); else data.validadeDias = n;
  }
  if (body.intervaloMinDias !== undefined) {
    if (body.intervaloMinDias === null || body.intervaloMinDias === '' || Number(body.intervaloMinDias) === 0) data.intervaloMinDias = null;
    else {
      const n = Number(body.intervaloMinDias);
      if (!Number.isInteger(n) || n < 1 || n > 180) campos.push('intervaloMinDias'); else data.intervaloMinDias = n;
    }
  }
  if (campos.length) throw falha(422, 'Confira os campos destacados.', campos);
  return data;
}

roteador.get('/modelos', requerPermissao('AGENDA', 'visualizar'), async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const modelos = await prisma.pacoteModelo.findMany({ where: { clienteId }, orderBy: [{ ativo: 'desc' }, { nome: 'asc' }] });
    const ativos = await prisma.pacoteCliente.groupBy({
      by: ['modeloId'], where: { clienteId, status: 'ATIVO' }, _count: { _all: true },
    });
    const porModelo = new Map(ativos.map((a) => [a.modeloId, a._count._all]));
    // Preco avulso do servico (menor variacao) pra mostrar a economia.
    const ids = [...new Set(modelos.map((m) => m.produtoId).filter(Boolean))];
    const variacoes = ids.length ? await prisma.variacaoProduto.findMany({ where: { produtoId: { in: ids } }, select: { produtoId: true, preco: true } }) : [];
    const avulso = new Map();
    for (const v of variacoes) avulso.set(v.produtoId, Math.min(avulso.get(v.produtoId) ?? Infinity, v.preco));
    res.json(modelos.map((m) => ({
      ...m,
      clientesAtivas: porModelo.get(m.id) || 0,
      valorSessao: round2(m.preco / m.sessoes),
      precoAvulso: Number.isFinite(avulso.get(m.produtoId)) ? avulso.get(m.produtoId) : null,
    })));
  } catch (e) {
    responderErro(res, e, 'modelos');
  }
});

roteador.post('/modelos', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const data = await lerModelo(clienteId, req.body || {});
    const modelo = await prisma.pacoteModelo.create({ data: { clienteId, ...data } });
    res.status(201).json(modelo);
  } catch (e) {
    responderErro(res, e, 'criar-modelo');
  }
});

roteador.put('/modelos/:id', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const existente = await prisma.pacoteModelo.findFirst({ where: { id: req.params.id, clienteId }, select: { id: true } });
    if (!existente) return res.status(404).json({ erro: 'Pacote não encontrado.' });
    const data = await lerModelo(clienteId, req.body || {}, { parcial: true });
    if (req.body?.ativo !== undefined) data.ativo = req.body.ativo === true;
    const modelo = await prisma.pacoteModelo.update({ where: { id: existente.id }, data });
    res.json(modelo);
  } catch (e) {
    responderErro(res, e, 'editar-modelo');
  }
});

roteador.delete('/modelos/:id', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const r = await prisma.pacoteModelo.updateMany({ where: { id: req.params.id, clienteId }, data: { ativo: false } });
    if (!r.count) return res.status(404).json({ erro: 'Pacote não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    responderErro(res, e, 'desativar-modelo');
  }
});

roteador.get('/clientes', requerPermissao('AGENDA', 'visualizar'), async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    await reconciliarEstornos({ clienteId }).catch(() => {});
    const agora = new Date();
    const filtro = req.query.filtro === 'acabando' ? 'acabando' : (req.query.filtro === 'encerrados' ? 'encerrados' : 'ativos');
    const lista = await prisma.pacoteCliente.findMany({
      where: { clienteId, status: filtro === 'encerrados' ? { in: ['ACABOU', 'VENCIDO', 'CANCELADO'] } : 'ATIVO' },
      include: { modelo: { select: { nome: true, servico: true } } },
      orderBy: { validoAte: 'asc' },
      take: 500,
    });
    const leads = await prisma.lead.findMany({ where: { id: { in: [...new Set(lista.map((p) => p.leadId))] }, clienteId }, select: { id: true, nome: true, telefone: true } });
    const leadPorId = new Map(leads.map((l) => [l.id, l]));
    const pendentes = await prisma.cobranca.findMany({
      where: { clienteId, origem: 'PACOTE', refId: { in: lista.map((p) => p.id) }, status: 'PENDENTE' },
      select: { refId: true, valor: true, vencimento: true },
    });
    const pendPorPacote = new Map(pendentes.map((c) => [c.refId, c]));
    const reservados = await pacotes.reservadosPorPacote(lista.map((p) => p.id));
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().toLowerCase() : '';

    const saida = lista
      .map((p) => ({
        id: p.id, modeloId: p.modeloId, pacote: p.modelo.nome, servico: p.modelo.servico,
        cliente: leadPorId.get(p.leadId) || { id: p.leadId, nome: 'Cliente removida', telefone: null },
        sessoesTotal: p.sessoesTotal, sessoesUsadas: p.sessoesUsadas, saldo: pacotes.saldoPacote(p),
        reservados: reservados.get(p.id) || 0,
        valor: p.valor, parcelas: p.parcelas, parcelasPagas: p.parcelasPagas, vendaId: p.vendaId,
        cobrancaPendente: pendPorPacote.get(p.id) || null,
        validoAte: p.validoAte, status: p.status, criadoEm: p.criadoEm,
        acabando: pacotes.estaAcabando(p, agora),
      }))
      .filter((p) => (filtro !== 'acabando' || p.acabando))
      .filter((p) => !busca || p.cliente.nome.toLowerCase().includes(busca) || digitos(p.cliente.telefone).includes(digitos(busca) || '__'));
    res.json(saida);
  } catch (e) {
    responderErro(res, e, 'clientes');
  }
});

roteador.post('/vender', requerPermissao('AGENDA', 'criar'), async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const { modeloId, leadId, nome, telefone, forma, metodoPagamento } = req.body || {};
    const parcelas = forma === 'PIX' ? Number(req.body?.parcelas || 1) : 1;
    const campos = [];
    if (forma !== 'CAIXA' && forma !== 'PIX') campos.push('forma');
    if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 12) campos.push('parcelas');
    if (forma === 'CAIXA' && metodoPagamento && !METODOS_CAIXA.includes(metodoPagamento)) campos.push('metodoPagamento');
    const modelo = typeof modeloId === 'string' ? await prisma.pacoteModelo.findFirst({ where: { id: modeloId, clienteId, ativo: true } }) : null;
    if (!modelo) campos.push('modeloId');
    if (campos.length) return res.status(422).json({ erro: 'Confira os campos destacados.', campos });
    if (forma === 'PIX' && !(await pagamentoConfigurado(clienteId))) {
      return res.status(422).json({ erro: 'Para cobrar por Pix, configure o recebimento em Pagamentos. Ou registre no caixa.', campos: ['forma'], codigo: 'SEM_PAGAMENTO' });
    }

    // Cliente: o lead escolhido, ou acha/cria pelo telefone.
    let lead = null;
    if (typeof leadId === 'string' && leadId) {
      lead = await prisma.lead.findFirst({ where: { id: leadId, clienteId }, select: { id: true, nome: true, telefone: true } });
      if (!lead) return res.status(422).json({ erro: 'Cliente inválida.', campos: ['leadId'] });
    } else {
      const nomeLimpo = typeof nome === 'string' ? nome.trim().slice(0, 80) : '';
      const tel = digitos(telefone);
      const c = [];
      if (nomeLimpo.length < 2) c.push('nome');
      if (tel.length < 10 || tel.length > 13) c.push('telefone');
      if (c.length) return res.status(422).json({ erro: 'Informe nome e WhatsApp da cliente.', campos: c });
      const leads = await prisma.lead.findMany({ where: { clienteId, telefone: { not: null } }, select: { id: true, nome: true, telefone: true } });
      lead = leads.find((l) => mesmoTelefone(l.telefone, tel)) || null;
      if (!lead) lead = await prisma.lead.create({ data: { clienteId, nome: nomeLimpo, telefone: tel, origem: 'PACOTE', valor: 0 }, select: { id: true, nome: true, telefone: true } });
    }

    const validoAte = pacotes.validoAteDe(new Date(), modelo.validadeDias);
    const descricaoVenda = `Pacote ${modelo.nome} (${modelo.sessoes} sessões)`;

    if (forma === 'CAIXA') {
      const variacao = modelo.produtoId
        ? await prisma.variacaoProduto.findFirst({ where: { produtoId: modelo.produtoId, produto: { clienteId } }, include: { produto: true }, orderBy: { preco: 'asc' } })
        : null;
      if (!variacao) return res.status(422).json({ erro: 'O serviço desse pacote não tem preço cadastrado no catálogo.', campos: ['modeloId'] });
      const resultado = await prisma.$transaction(async (tx) => {
        await lockClienteAdvisory(tx, clienteId);
        const { sessao } = await obterOuAbrirSessaoCaixa(tx, clienteId, { motivo: 'Aberto automaticamente ao vender um pacote sem caixa aberto.' });
        const venda = await criarVenda({
          clienteId, sessaoCaixaId: sessao.id, leadId: lead.id, metodoPagamento: metodoPagamento || null, descricaoVenda,
          itensValidados: [{ variacao, quantidade: 1, precoUnitario: modelo.preco, subtotal: modelo.preco }], tx,
        });
        const pacote = await tx.pacoteCliente.create({
          data: {
            clienteId, modeloId: modelo.id, leadId: lead.id, sessoesTotal: modelo.sessoes, valor: modelo.preco,
            parcelas: 1, parcelasPagas: 1, vendaId: venda.venda.id, validoAte,
          },
        });
        return { pacote, venda: venda.venda };
      }, { timeout: 15000 });
      return res.status(201).json({ pacote: resultado.pacote, venda: { id: resultado.venda.id, numero: resultado.venda.numero, valor: resultado.venda.valor } });
    }

    // PIX (parcelado ou nao): a 1a parcela sai agora; as outras, a cada mes, quando a anterior e paga.
    const pacote = await prisma.pacoteCliente.create({
      data: { clienteId, modeloId: modelo.id, leadId: lead.id, sessoesTotal: modelo.sessoes, valor: modelo.preco, parcelas, parcelasPagas: 0, validoAte },
    });
    let cobranca;
    try {
      cobranca = await pacotes.cobrarParcela({ pacote, nomeModelo: modelo.nome, lead, numero: 1 });
    } catch (e) {
      await prisma.pacoteCliente.delete({ where: { id: pacote.id } }).catch(() => {});
      console.error('[pacotes/vender pix]', e?.message);
      return res.status(502).json({ erro: 'Não foi possível gerar o Pix agora. Tente de novo ou registre no caixa.' });
    }
    res.status(201).json({
      pacote,
      cobranca: { id: cobranca.id, valor: cobranca.valor, qrCode: cobranca.qrCode, linkUrl: cobranca.linkUrl, vencimento: cobranca.vencimento },
      mensagem: lead.telefone ? `Pix de ${brl(cobranca.valor)} enviado pro WhatsApp de ${lead.nome}.` : `Pix de ${brl(cobranca.valor)} gerado.`,
    });
  } catch (e) {
    responderErro(res, e, 'vender');
  }
});

roteador.post('/clientes/:id/reenviar-pix', requerPermissao('AGENDA', 'editar'), async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const pacote = await prisma.pacoteCliente.findFirst({ where: { id: req.params.id, clienteId }, include: { modelo: { select: { nome: true } } } });
    if (!pacote) return res.status(404).json({ erro: 'Pacote não encontrado.' });
    if (pacote.status === 'CANCELADO') return res.status(409).json({ erro: 'Esse pacote foi cancelado.' });
    if (pacote.parcelasPagas >= pacote.parcelas) return res.status(409).json({ erro: 'Esse pacote já está todo pago.' });
    const lead = await prisma.lead.findFirst({ where: { id: pacote.leadId, clienteId }, select: { nome: true, telefone: true } });
    if (!lead?.telefone) return res.status(422).json({ erro: 'A cliente não tem WhatsApp cadastrado.' });
    const pendente = await prisma.cobranca.findFirst({ where: { clienteId, origem: 'PACOTE', refId: pacote.id, status: 'PENDENTE' }, orderBy: { criadoEm: 'desc' } });
    if (pendente?.qrCode) {
      const { enviarMensagemTenant } = require('../services/mensagemTenant');
      await enviarMensagemTenant({
        clienteId, para: lead.telefone, tipo: 'conversa',
        texto: `Oi, ${String(lead.nome).split(' ')[0]}! Segue de novo o Pix do pacote ${pacote.modelo.nome} (parcela ${pacote.parcelasPagas + 1} de ${pacote.parcelas}): ${brl(pendente.valor)}.\n\nPix copia e cola:\n${pendente.qrCode}`,
      });
      return res.json({ ok: true, mensagem: `Pix enviado de novo pro WhatsApp de ${lead.nome}.` });
    }
    if (!(await pagamentoConfigurado(clienteId))) return res.status(422).json({ erro: 'Configure o recebimento em Pagamentos para cobrar por Pix.', codigo: 'SEM_PAGAMENTO' });
    const nova = await pacotes.cobrarParcela({ pacote, nomeModelo: pacote.modelo.nome, lead, numero: pacote.parcelasPagas + 1 });
    res.json({ ok: true, mensagem: `Pix de ${brl(nova.valor)} enviado pro WhatsApp de ${lead.nome}.` });
  } catch (e) {
    responderErro(res, e, 'reenviar');
  }
});

roteador.post('/clientes/:id/cancelar', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const r = await prisma.pacoteCliente.updateMany({ where: { id: req.params.id, clienteId, status: { not: 'CANCELADO' } }, data: { status: 'CANCELADO' } });
    if (!r.count) return res.status(404).json({ erro: 'Pacote não encontrado ou já cancelado.' });
    await prisma.cobranca.updateMany({ where: { clienteId, origem: 'PACOTE', refId: req.params.id, status: 'PENDENTE' }, data: { status: 'CANCELADO' } });
    // Horarios futuros marcados com esse pacote voltam a ser cobrados normalmente.
    await prisma.agendamento.updateMany({ where: { clienteId, pacoteClienteId: req.params.id, status: { in: ['PENDING', 'CONFIRMED'] } }, data: { pacoteClienteId: null } });
    res.json({ ok: true });
  } catch (e) {
    responderErro(res, e, 'cancelar');
  }
});

module.exports = roteador;

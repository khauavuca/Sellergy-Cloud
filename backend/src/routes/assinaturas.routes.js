// Assinaturas dos clientes — painel do ADMIN (dono do Sellergy).
//
//   GET  /admin/assinaturas                     -> clientes + status + faturas em aberto
//   PUT  /admin/assinaturas/:clienteId          -> { plano?, statusAssinatura?, trialAte?, proximaCobrancaEm?, mensalidade? }
//   POST /admin/assinaturas/faturas/:id/pagar   -> baixa manual de fatura
//
// Enquanto a cobranca automatica nao esta ligada, a baixa e manual aqui.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerAdmin } = require('../middlewares/permissoes.middleware');
const { situacaoAssinatura } = require('../assinatura/situacao');
const { marcarFaturaPaga, recalcularStatus, cancelarAssinatura, estenderTeste, valorDoCiclo } = require('../assinatura/cobranca');
const asaasPlataforma = require('../assinatura/asaasPlataforma');
const { PLANOS } = require('../planos/catalogo');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerAdmin);

const STATUS_VALIDOS = ['TRIAL', 'ATIVA', 'ATRASADA', 'SUSPENSA', 'CANCELADA'];

roteador.get('/', async (req, res) => {
  try {
    const clientes = await prisma.cliente.findMany({
      select: {
        id: true, nome: true, email: true, telefone: true, segmento: true, plano: true, mensalidade: true, statusAssinatura: true,
        trialAte: true, proximaCobrancaEm: true, criadoEm: true, cicloAssinatura: true, formaPagamento: true,
        canceladoEm: true, motivoCancelamento: true, asaasAssinaturaId: true,
        faturasAssinatura: {
          where: { status: { in: ['ABERTA', 'VENCIDA'] } },
          select: { id: true, competencia: true, valor: true, vencimento: true, status: true },
          orderBy: { vencimento: 'asc' },
        },
      },
      orderBy: { criadoEm: 'desc' },
    });
    res.json(clientes.map((c) => ({ ...c, situacao: situacaoAssinatura(c) })));
  } catch (e) {
    console.error('[admin/assinaturas]', e);
    res.status(500).json({ erro: 'Erro ao listar assinaturas.' });
  }
});

// GET /admin/assinaturas/resumo — numeros do painel (visao geral).
roteador.get('/resumo', async (req, res) => {
  try {
    const agora = new Date();
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const [porStatus, pagantes, canceladosMes, cadastrosMes, recebidoMes, vencido] = await Promise.all([
      prisma.cliente.groupBy({ by: ['statusAssinatura'], _count: { _all: true } }),
      prisma.cliente.findMany({
        where: { statusAssinatura: { in: ['ATIVA', 'ATRASADA'] } },
        select: { plano: true, mensalidade: true, cicloAssinatura: true },
      }),
      prisma.cliente.count({ where: { canceladoEm: { gte: inicioMes } } }),
      prisma.cliente.count({ where: { criadoEm: { gte: inicioMes } } }),
      prisma.faturaAssinatura.aggregate({ where: { status: 'PAGA', pagaEm: { gte: inicioMes } }, _sum: { valor: true } }),
      prisma.faturaAssinatura.aggregate({ where: { status: 'VENCIDA' }, _sum: { valor: true }, _count: { _all: true } }),
    ]);
    const contagem = Object.fromEntries(porStatus.map((g) => [g.statusAssinatura, g._count._all]));
    // MRR: receita recorrente por mes (anual entra dividido por 12).
    const mrr = pagantes.reduce((t, c) => t + valorDoCiclo(c.plano, c.cicloAssinatura, c.mensalidade) / (c.cicloAssinatura === 'ANUAL' ? 12 : 1), 0);
    const ativosInicio = pagantes.length + canceladosMes;
    res.json({
      mrr: Math.round(mrr * 100) / 100,
      pagantes: pagantes.length,
      emTeste: contagem.TRIAL || 0,
      atrasadas: contagem.ATRASADA || 0,
      suspensas: contagem.SUSPENSA || 0,
      canceladas: contagem.CANCELADA || 0,
      canceladosNoMes: canceladosMes,
      cancelamentoPct: ativosInicio ? Math.round((canceladosMes / ativosInicio) * 1000) / 10 : 0,
      cadastrosNoMes: cadastrosMes,
      recebidoNoMes: recebidoMes._sum.valor || 0,
      vencidoTotal: vencido._sum.valor || 0,
      faturasVencidas: vencido._count._all,
      cobrancaAutomatica: asaasPlataforma.ativo(),
    });
  } catch (e) {
    console.error('[admin/assinaturas/resumo]', e);
    res.status(500).json({ erro: 'Erro ao calcular o resumo.' });
  }
});

// GET /admin/assinaturas/:clienteId/faturas — historico completo.
roteador.get('/:clienteId/faturas', async (req, res) => {
  try {
    const faturas = await prisma.faturaAssinatura.findMany({
      where: { clienteId: req.params.clienteId }, orderBy: { vencimento: 'desc' }, take: 36,
      select: { id: true, competencia: true, valor: true, vencimento: true, status: true, linkPagamento: true, formaPagamento: true, pagaEm: true },
    });
    res.json(faturas);
  } catch (e) {
    console.error('[admin/assinaturas/faturas]', e);
    res.status(500).json({ erro: 'Erro ao listar faturas.' });
  }
});

// POST /admin/assinaturas/:clienteId/estender-teste { dias? }
roteador.post('/:clienteId/estender-teste', async (req, res) => {
  try {
    const dias = Number(req.body?.dias ?? 7);
    if (!Number.isInteger(dias) || dias < 1 || dias > 60) return res.status(422).json({ erro: 'Dias entre 1 e 60.', campos: ['dias'] });
    const cliente = await estenderTeste(req.params.clienteId, dias);
    console.log(`[auditoria] admin ${req.usuario.id} estendeu o teste de ${req.params.clienteId} em ${dias} dias`);
    res.json({ ...cliente, situacao: situacaoAssinatura(cliente) });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ erro: 'Cliente não encontrado.' });
    console.error('[admin/assinaturas/estender]', e);
    res.status(500).json({ erro: 'Erro ao estender o teste.' });
  }
});

// POST /admin/assinaturas/:clienteId/cancelar { motivo? }
roteador.post('/:clienteId/cancelar', async (req, res) => {
  try {
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo : null;
    const cliente = await cancelarAssinatura(req.params.clienteId, { motivo });
    console.log(`[auditoria] admin ${req.usuario.id} cancelou a assinatura de ${req.params.clienteId}`);
    res.json(cliente);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ erro: 'Cliente não encontrado.' });
    console.error('[admin/assinaturas/cancelar]', e);
    res.status(500).json({ erro: 'Erro ao cancelar.' });
  }
});

// POST /admin/assinaturas/:clienteId/suspender | /reativar
roteador.post('/:clienteId/:acao(suspender|reativar)', async (req, res) => {
  try {
    const status = req.params.acao === 'suspender' ? 'SUSPENSA' : 'ATIVA';
    const cliente = await prisma.cliente.update({
      where: { id: req.params.clienteId },
      data: { statusAssinatura: status, ...(status === 'ATIVA' ? { canceladoEm: null } : {}) },
      select: { id: true, plano: true, statusAssinatura: true, trialAte: true },
    });
    console.log(`[auditoria] admin ${req.usuario.id} -> ${req.params.acao} ${req.params.clienteId}`);
    res.json({ ...cliente, situacao: situacaoAssinatura(cliente) });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ erro: 'Cliente não encontrado.' });
    console.error('[admin/assinaturas/acao]', e);
    res.status(500).json({ erro: 'Erro ao atualizar a conta.' });
  }
});


roteador.put('/:clienteId', async (req, res) => {
  try {
    const { plano, statusAssinatura, trialAte, proximaCobrancaEm, mensalidade } = req.body || {};
    const data = {};
    if (plano !== undefined) {
      if (!PLANOS[plano]) return res.status(422).json({ erro: 'Plano inválido.', campos: ['plano'] });
      data.plano = plano;
    }
    if (statusAssinatura !== undefined) {
      if (!STATUS_VALIDOS.includes(statusAssinatura)) return res.status(422).json({ erro: 'Status inválido.', campos: ['statusAssinatura'] });
      data.statusAssinatura = statusAssinatura;
    }
    for (const [campo, valor] of [['trialAte', trialAte], ['proximaCobrancaEm', proximaCobrancaEm]]) {
      if (valor === undefined) continue;
      if (valor === null) { data[campo] = null; continue; }
      const d = new Date(valor);
      if (Number.isNaN(d.getTime())) return res.status(422).json({ erro: `${campo} inválida.`, campos: [campo] });
      data[campo] = d;
    }
    if (mensalidade !== undefined) {
      const v = Number(mensalidade);
      if (!Number.isFinite(v) || v < 0) return res.status(422).json({ erro: 'Mensalidade inválida.', campos: ['mensalidade'] });
      data.mensalidade = v;
    }
    const cliente = await prisma.cliente.update({
      where: { id: req.params.clienteId }, data,
      select: { id: true, plano: true, statusAssinatura: true, trialAte: true, proximaCobrancaEm: true, mensalidade: true },
    });
    res.json({ ...cliente, situacao: situacaoAssinatura(cliente) });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ erro: 'Cliente não encontrado.' });
    console.error('[admin/assinaturas/put]', e);
    res.status(500).json({ erro: 'Erro ao atualizar a assinatura.' });
  }
});

roteador.post('/faturas/:id/pagar', async (req, res) => {
  try {
    const fatura = await marcarFaturaPaga(req.params.id);
    const status = await recalcularStatus(fatura.clienteId);
    res.json({ fatura, statusAssinatura: status });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ erro: 'Fatura não encontrada.' });
    console.error('[admin/assinaturas/pagar]', e);
    res.status(500).json({ erro: 'Erro ao dar baixa na fatura.' });
  }
});

module.exports = roteador;

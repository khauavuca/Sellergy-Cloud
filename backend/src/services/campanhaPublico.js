// Publico de campanha: quem cai em cada segmento, o filtro opcional de
// "gastou mais de R$ X na ultima visita" e quem fica de fora (pediu SAIR ou
// nao tem telefone). Usado pela criacao (contagem), pela previa da tela e
// pelo disparo (que resolve tudo de novo, com dado fresco).
//
// Tudo filtra por clienteId. As regras puras (sem banco) ficam exportadas
// pra teste.

const prisma = require('../prisma');
const { mesclarConversoes, LIMITE_RECORRENTE, DIAS_MIN_LEAD_NOVO } = require('./segmentacaoLeads');
const { telefoneParaWhatsapp } = require('./whatsappDoTenant');

const MS_DIA = 24 * 60 * 60 * 1000;
const DIAS_PADRAO = 30;
const TZ = 'America/Sao_Paulo';

const SEGMENTOS_VALIDOS = new Set(['recompra', 'recorrentes', 'nunca-converteram', 'convertidos', 'aniversariantes']);

/** Mes (0-11) de "agora" no horario de Brasilia. PURA. */
function mesBrasilia(agora = new Date()) {
  const [, mes] = agora.toLocaleDateString('en-CA', { timeZone: TZ }).split('-').map(Number);
  return mes - 1;
}

/**
 * Faz aniversario no mes corrente? Data de nascimento e gravada como dia
 * (meia-noite UTC), entao o mes UTC e o mes do aniversario. PURA.
 */
function ehAniversarianteDoMes(dataNascimento, agora = new Date()) {
  if (!dataNascimento) return false;
  const d = new Date(dataNascimento);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCMonth() === mesBrasilia(agora);
}

/**
 * Mantem so os leads cuja ULTIMA venda concluida passou de `gastoMinimo`.
 * `ultimasVendas` = [{ leadId, valor }] ja na ordem "mais recente primeiro"
 * e com 1 linha por lead. Quem nao tem venda sai. PURA.
 */
function filtrarPorGastoMinimo(leadIds, ultimasVendas, gastoMinimo) {
  if (!gastoMinimo) return leadIds;
  const valorPorLead = new Map(ultimasVendas.map((v) => [v.leadId, Number(v.valor) || 0]));
  return leadIds.filter((id) => (valorPorLead.get(id) ?? -1) > gastoMinimo);
}

/**
 * Separa quem recebe de quem fica de fora. `leads` = [{ id, telefone }],
 * `telefonesSair` = Set de telefones (com 55) que pediram SAIR. PURA.
 */
function separarPublico(leads, telefonesSair) {
  const recebem = [];
  let semPermissao = 0;
  let semTelefone = 0;
  for (const l of leads) {
    const para = telefoneParaWhatsapp(l.telefone);
    if (!para || para.length < 12) { semTelefone += 1; continue; }
    if (telefonesSair.has(para)) { semPermissao += 1; continue; }
    recebem.push(l.id);
  }
  return { recebem, semPermissao, semTelefone };
}

// Vendas COMPLETED + atendimentos COMPLETED por lead num unico mapa.
async function buscarConversoesPorLead(clienteId) {
  const [vendasPorLead, agendamentosPorLead] = await Promise.all([
    prisma.venda.groupBy({
      by: ['leadId'],
      where: { clienteId, status: 'COMPLETED', leadId: { not: null } },
      _count: { _all: true },
      _sum: { valor: true },
      _max: { data: true },
    }),
    prisma.agendamento.groupBy({
      by: ['leadId'],
      where: { clienteId, status: 'COMPLETED', leadId: { not: null } },
      _count: { _all: true },
      _max: { data: true },
    }),
  ]);
  return mesclarConversoes(vendasPorLead, agendamentosPorLead);
}

/** IDs dos leads de 1 segmento (sem o filtro de gasto nem o de SAIR). */
async function resolverLeadIdsDoSegmento(clienteId, segmento, { diasRecompra = DIAS_PADRAO, agora = new Date() } = {}) {
  if (segmento === 'recompra') {
    const corte = new Date(agora.getTime() - diasRecompra * MS_DIA);
    const grupos = await prisma.venda.groupBy({
      by: ['leadId'],
      where: { clienteId, status: 'COMPLETED', leadId: { not: null } },
      _max: { data: true },
    });
    return grupos.filter((g) => g._max.data && new Date(g._max.data) <= corte).map((g) => g.leadId);
  }

  if (segmento === 'aniversariantes') {
    const leads = await prisma.lead.findMany({
      where: { clienteId, dataNascimento: { not: null } },
      select: { id: true, dataNascimento: true },
    });
    return leads.filter((l) => ehAniversarianteDoMes(l.dataNascimento, agora)).map((l) => l.id);
  }

  const mapa = await buscarConversoesPorLead(clienteId);
  if (segmento === 'recorrentes') {
    return [...mapa.values()].filter((e) => (e.compras + e.atendimentos) >= LIMITE_RECORRENTE).map((e) => e.leadId);
  }
  if (segmento === 'convertidos') {
    return [...mapa.keys()];
  }
  if (segmento === 'nunca-converteram') {
    const corte = new Date(agora.getTime() - DIAS_MIN_LEAD_NOVO * MS_DIA);
    const leads = await prisma.lead.findMany({
      where: { clienteId, criadoEm: { lte: corte }, id: { notIn: [...mapa.keys()] } },
      select: { id: true },
    });
    return leads.map((l) => l.id);
  }
  return [];
}

/**
 * Publico completo de uma campanha: segmento + gasto minimo + quem fica de
 * fora. Devolve os IDs de quem recebe e as contagens pra tela.
 */
async function resumirPublico(clienteId, { segmento, diasRecompra = DIAS_PADRAO, gastoMinimo = null, agora = new Date() }) {
  let leadIds = await resolverLeadIdsDoSegmento(clienteId, segmento, { diasRecompra, agora });

  if (gastoMinimo && leadIds.length) {
    const ultimas = await prisma.venda.findMany({
      where: { clienteId, status: 'COMPLETED', leadId: { in: leadIds } },
      orderBy: { data: 'desc' },
      distinct: ['leadId'],
      select: { leadId: true, valor: true },
    });
    leadIds = filtrarPorGastoMinimo(leadIds, ultimas, gastoMinimo);
  }

  const total = leadIds.length;
  if (!total) return { total: 0, recebem: [], semPermissao: 0, semTelefone: 0 };

  const leads = await prisma.lead.findMany({
    where: { clienteId, id: { in: leadIds } },
    select: { id: true, telefone: true },
  });
  const telefones = [...new Set(leads.map((l) => telefoneParaWhatsapp(l.telefone)).filter(Boolean))];
  const sair = telefones.length
    ? await prisma.optOutWhatsapp.findMany({ where: { clienteId, telefone: { in: telefones } }, select: { telefone: true } })
    : [];
  const separado = separarPublico(leads, new Set(sair.map((s) => s.telefone)));
  return { total, ...separado };
}

module.exports = {
  SEGMENTOS_VALIDOS,
  DIAS_PADRAO,
  buscarConversoesPorLead,
  resolverLeadIdsDoSegmento,
  resumirPublico,
  // puras
  ehAniversarianteDoMes,
  filtrarPorGastoMinimo,
  separarPublico,
};

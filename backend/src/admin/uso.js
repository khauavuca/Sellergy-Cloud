// =====================================================================
// USO E CUSTOS POR CLIENTE (painel admin)
// =====================================================================
// Quanto cada negocio usou no mes, quanto paga e quanto custa pro Sellergy.
//
// Mensagens de WhatsApp contadas (so o que fica registrado no banco):
//   - lembretes: Agendamento.lembrete24hEm / lembrete2hEm dentro do mes;
//   - campanhas: CampanhaEnvio ENVIADO (enviadoEm no mes);
//   - encaixe:   OfertaEncaixeEnvio (enviadoEm no mes);
//   - pedidos:   Pedido de origem WHATSAPP criado no mes (1 mensagem com o Pix).
// Canal: se o negocio tem um numero pelo canal oficial (bot META_CLOUD), a
// mensagem custa o preco "oficial"; senao, o do QR Code.
// Notas: DocumentoFiscal EMITIDA criada no mes.
//
// Precos unitarios e custos fixos: ConfigPlataforma chave 'custos', editaveis
// na tela (comecam em zero — nada de numero inventado).
// =====================================================================

const prisma = require('../prisma');
const { obterPlano } = require('../planos/catalogo');
const { valorDoCiclo } = require('../assinatura/cobranca');

const CHAVE_CUSTOS = 'custos';
const CUSTOS_PADRAO = Object.freeze({ mensagemOficial: 0, mensagemQr: 0, nota: 0, fixos: [] });

function arred(v) { return Math.round((Number(v) || 0) * 100) / 100; }

function normalizarCustos(valor) {
  const v = valor && typeof valor === 'object' ? valor : {};
  const num = (x) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : 0);
  const fixos = Array.isArray(v.fixos)
    ? v.fixos
      .filter((f) => f && typeof f.nome === 'string' && f.nome.trim())
      .map((f) => ({ nome: f.nome.trim().slice(0, 60), valor: arred(num(f.valor)) }))
      .slice(0, 30)
    : [];
  return { mensagemOficial: num(v.mensagemOficial), mensagemQr: num(v.mensagemQr), nota: num(v.nota), fixos };
}

/** Valida o corpo do PUT de custos. Devolve { erro, campos } ou { custos }. */
function validarCustos(corpo) {
  const campos = [];
  for (const k of ['mensagemOficial', 'mensagemQr', 'nota']) {
    const v = Number(corpo?.[k]);
    if (!Number.isFinite(v) || v < 0 || v > 100) campos.push(k);
  }
  if (corpo?.fixos !== undefined && !Array.isArray(corpo.fixos)) campos.push('fixos');
  (Array.isArray(corpo?.fixos) ? corpo.fixos : []).forEach((f, i) => {
    if (!f || typeof f.nome !== 'string' || !f.nome.trim() || f.nome.length > 60) campos.push(`fixos.${i}.nome`);
    const v = Number(f?.valor);
    if (!Number.isFinite(v) || v < 0 || v > 1_000_000) campos.push(`fixos.${i}.valor`);
  });
  if ((corpo?.fixos || []).length > 30) campos.push('fixos');
  if (campos.length) return { erro: 'Confira os valores: números a partir de zero.', campos };
  return { custos: normalizarCustos(corpo) };
}

async function lerCustos() {
  const linha = await prisma.configPlataforma.findUnique({ where: { chave: CHAVE_CUSTOS } });
  return normalizarCustos(linha?.valor || CUSTOS_PADRAO);
}

async function salvarCustos(custos) {
  await prisma.configPlataforma.upsert({
    where: { chave: CHAVE_CUSTOS },
    create: { chave: CHAVE_CUSTOS, valor: custos },
    update: { valor: custos },
  });
  return custos;
}

/** Quanto o negocio paga por mes (anual entra dividido por 12). Teste, suspenso e cancelado = 0. */
function receitaMensal(cliente) {
  if (!['ATIVA', 'ATRASADA'].includes(cliente.statusAssinatura)) return 0;
  const ciclo = cliente.cicloAssinatura || 'MENSAL';
  const valor = valorDoCiclo(cliente.plano, ciclo, cliente.mensalidade || 0);
  return arred(ciclo === 'ANUAL' ? valor / 12 : valor);
}

/**
 * Logica pura: junta contagens, custos e planos.
 *   clientes: [{ id, nome, plano, statusAssinatura, cicloAssinatura, mensalidade }]
 *   uso: Map clienteId -> { lembretes, campanhas, encaixe, pedidos, notas, usuarios, oficial }
 */
function calcularUso({ clientes, uso, custos, planoDe = obterPlano }) {
  const c = normalizarCustos(custos);
  const linhas = clientes.map((cli) => {
    const u = uso.get(cli.id) || {};
    const lembretes = u.lembretes || 0;
    const mensagens = lembretes + (u.campanhas || 0) + (u.encaixe || 0) + (u.pedidos || 0);
    const notas = u.notas || 0;
    const precoMsg = u.oficial ? c.mensagemOficial : c.mensagemQr;
    const custo = arred(mensagens * precoMsg + notas * c.nota);
    const paga = receitaMensal(cli);
    const margemPct = paga > 0 ? Math.round(((paga - custo) / paga) * 1000) / 10 : null;
    const plano = planoDe(cli.plano);
    const limites = plano.limites || {};
    const acima = [];
    if (Number.isFinite(limites.lembretesMes) && lembretes > limites.lembretesMes) acima.push({ limite: 'lembretesMes', uso: lembretes, maximo: limites.lembretesMes });
    if (Number.isFinite(limites.notasMes) && notas > limites.notasMes) acima.push({ limite: 'notasMes', uso: notas, maximo: limites.notasMes });
    if (Number.isFinite(limites.usuarios) && (u.usuarios || 0) > limites.usuarios) acima.push({ limite: 'usuarios', uso: u.usuarios, maximo: limites.usuarios });
    return {
      clienteId: cli.id,
      nome: cli.nome,
      plano: cli.plano,
      planoNome: plano.nome,
      statusAssinatura: cli.statusAssinatura,
      canal: u.oficial ? 'OFICIAL' : 'QR',
      mensagens: { total: mensagens, lembretes, campanhas: u.campanhas || 0, encaixe: u.encaixe || 0, pedidos: u.pedidos || 0 },
      notas,
      usuarios: u.usuarios || 0,
      custo,
      paga,
      margemPct,
      prejuizo: paga > 0 ? custo > paga : custo > 0,
      acimaDoLimite: acima,
    };
  }).sort((a, b) => b.custo - a.custo || b.mensagens.total - a.mensagens.total);

  const receita = arred(linhas.reduce((t, l) => t + l.paga, 0));
  const custoVariavel = arred(linhas.reduce((t, l) => t + l.custo, 0));
  const custoFixo = arred(c.fixos.reduce((t, f) => t + f.valor, 0));
  const custoTotal = arred(custoVariavel + custoFixo);
  return {
    linhas,
    totais: {
      receita,
      custoVariavel,
      custoFixo,
      custoTotal,
      margemBruta: arred(receita - custoTotal),
      margemBrutaPct: receita > 0 ? Math.round(((receita - custoTotal) / receita) * 1000) / 10 : null,
      mensagens: linhas.reduce((t, l) => t + l.mensagens.total, 0),
      notas: linhas.reduce((t, l) => t + l.notas, 0),
      acimaDoLimite: linhas.filter((l) => l.acimaDoLimite.length).length,
    },
    custos: c,
  };
}

/** 'YYYY-MM' -> [inicio, fim) no fuso do processo. */
function intervaloDoMes(competencia) {
  const agora = new Date();
  let ano = agora.getFullYear();
  let mes = agora.getMonth();
  if (typeof competencia === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) {
    ano = Number(competencia.slice(0, 4));
    mes = Number(competencia.slice(5, 7)) - 1;
  }
  const inicio = new Date(ano, mes, 1);
  const fim = new Date(ano, mes + 1, 1);
  return { inicio, fim, competencia: `${ano}-${String(mes + 1).padStart(2, '0')}` };
}

function somar(mapa, clienteId, campo, n) {
  if (!clienteId) return;
  const atual = mapa.get(clienteId) || {};
  atual[campo] = (atual[campo] || 0) + n;
  mapa.set(clienteId, atual);
}

/** Busca as contagens do mes no banco (consultas agrupadas, sem SQL cru). */
async function contarUso({ inicio, fim }) {
  const noMes = { gte: inicio, lt: fim };
  const [l24, l2, envios, encaixe, pedidos, notas, usuarios, botsOficiais] = await Promise.all([
    prisma.agendamento.groupBy({ by: ['clienteId'], where: { lembrete24hEm: noMes }, _count: { _all: true } }),
    prisma.agendamento.groupBy({ by: ['clienteId'], where: { lembrete2hEm: noMes }, _count: { _all: true } }),
    prisma.campanhaEnvio.groupBy({ by: ['campanhaId'], where: { status: 'ENVIADO', enviadoEm: noMes }, _count: { _all: true } }),
    prisma.ofertaEncaixeEnvio.groupBy({ by: ['ofertaId'], where: { enviadoEm: noMes }, _count: { _all: true } }),
    prisma.pedido.groupBy({ by: ['clienteId'], where: { origem: 'WHATSAPP', criadoEm: noMes }, _count: { _all: true } }),
    prisma.documentoFiscal.groupBy({ by: ['clienteId'], where: { status: 'EMITIDA', criadoEm: noMes }, _count: { _all: true } }),
    prisma.usuario.groupBy({ by: ['clienteId'], where: { clienteId: { not: null } }, _count: { _all: true } }),
    prisma.bot.findMany({ where: { provedorCanal: 'META_CLOUD', identificadorCanal: { not: null } }, select: { clienteId: true }, distinct: ['clienteId'] }),
  ]);
  const uso = new Map();
  l24.forEach((g) => somar(uso, g.clienteId, 'lembretes', g._count._all));
  l2.forEach((g) => somar(uso, g.clienteId, 'lembretes', g._count._all));
  if (envios.length) {
    const campanhas = await prisma.campanha.findMany({ where: { id: { in: envios.map((e) => e.campanhaId) } }, select: { id: true, clienteId: true } });
    const dono = new Map(campanhas.map((c) => [c.id, c.clienteId]));
    envios.forEach((e) => somar(uso, dono.get(e.campanhaId), 'campanhas', e._count._all));
  }
  if (encaixe.length) {
    const ofertas = await prisma.ofertaEncaixe.findMany({ where: { id: { in: encaixe.map((e) => e.ofertaId) } }, select: { id: true, clienteId: true } });
    const dono = new Map(ofertas.map((o) => [o.id, o.clienteId]));
    encaixe.forEach((e) => somar(uso, dono.get(e.ofertaId), 'encaixe', e._count._all));
  }
  pedidos.forEach((g) => somar(uso, g.clienteId, 'pedidos', g._count._all));
  notas.forEach((g) => somar(uso, g.clienteId, 'notas', g._count._all));
  usuarios.forEach((g) => somar(uso, g.clienteId, 'usuarios', g._count._all));
  botsOficiais.forEach((b) => { const a = uso.get(b.clienteId) || {}; a.oficial = true; uso.set(b.clienteId, a); });
  return uso;
}

async function relatorioDeUso(competencia) {
  const periodo = intervaloDoMes(competencia);
  const [clientes, uso, custos] = await Promise.all([
    prisma.cliente.findMany({
      where: { OR: [{ statusAssinatura: { not: 'CANCELADA' } }, { canceladoEm: { gte: periodo.inicio } }] },
      select: { id: true, nome: true, plano: true, statusAssinatura: true, cicloAssinatura: true, mensalidade: true },
    }),
    contarUso(periodo),
    lerCustos(),
  ]);
  return { competencia: periodo.competencia, ...calcularUso({ clientes, uso, custos }) };
}

module.exports = {
  CHAVE_CUSTOS,
  normalizarCustos,
  validarCustos,
  lerCustos,
  salvarCustos,
  receitaMensal,
  calcularUso,
  intervaloDoMes,
  contarUso,
  relatorioDeUso,
};

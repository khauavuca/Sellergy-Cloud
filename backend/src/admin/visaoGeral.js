// =====================================================================
// VISAO GERAL DO PAINEL ADMIN (complementa GET /admin/assinaturas/resumo)
// =====================================================================
//   - receita por mes: faturas PAGAS dos ultimos 6 meses (por pagaEm);
//   - conversao do teste: quem saiu do teste nos ultimos 90 dias e virou
//     pagante / todos que sairam do teste nesse periodo;
//   - funil do mes: cadastros -> ativaram (1 venda ou 1 agendamento) -> pagaram;
//   - "Precisa de voce": itens reais com link pra area certa.
// =====================================================================

const prisma = require('../prisma');

const NOME_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Agrupa faturas pagas por mes; sempre devolve os N meses (zerados inclusive). */
function receitaPorMes(faturas, agora = new Date(), meses = 6) {
  const saida = [];
  for (let i = meses - 1; i >= 0; i -= 1) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    saida.push({ mes: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, rotulo: `${NOME_MES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, valor: 0, faturas: 0 });
  }
  const porMes = new Map(saida.map((m) => [m.mes, m]));
  for (const f of faturas) {
    if (!f.pagaEm) continue;
    const d = new Date(f.pagaEm);
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = porMes.get(chave);
    if (!m) continue;
    m.valor = Math.round((m.valor + Number(f.valor || 0)) * 100) / 100;
    m.faturas += 1;
  }
  return saida;
}

/** Conversao: pagantes que vieram do teste / testes encerrados (em %). */
function conversaoDoTeste(encerrados) {
  const total = encerrados.length;
  const viraram = encerrados.filter((c) => ['ATIVA', 'ATRASADA'].includes(c.statusAssinatura) || c.pagou).length;
  return { encerrados: total, viraramPagantes: viraram, pct: total ? Math.round((viraram / total) * 1000) / 10 : null };
}

async function idsComAtividade(ids) {
  if (!ids.length) return new Set();
  const [vendas, agendamentos] = await Promise.all([
    prisma.venda.groupBy({ by: ['clienteId'], where: { clienteId: { in: ids } }, _count: { _all: true } }),
    prisma.agendamento.groupBy({ by: ['clienteId'], where: { clienteId: { in: ids } }, _count: { _all: true } }),
  ]);
  return new Set([...vendas, ...agendamentos].map((g) => g.clienteId));
}

async function montarVisaoGeral(agora = new Date()) {
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const inicio6m = new Date(agora.getFullYear(), agora.getMonth() - 5, 1);
  const ha90 = new Date(agora.getTime() - 90 * 24 * 60 * 60 * 1000);
  const em3dias = new Date(agora.getTime() + 3 * 24 * 60 * 60 * 1000);

  const [faturasPagas, encerrados, cadastrosMes, faturasVencidas, testesAcabando, chamadosAbertos] = await Promise.all([
    prisma.faturaAssinatura.findMany({ where: { status: 'PAGA', pagaEm: { gte: inicio6m } }, select: { valor: true, pagaEm: true } }),
    prisma.cliente.findMany({
      where: { trialAte: { gte: ha90, lte: agora } },
      select: { id: true, statusAssinatura: true, faturasAssinatura: { where: { status: 'PAGA' }, select: { id: true }, take: 1 } },
    }),
    prisma.cliente.findMany({ where: { criadoEm: { gte: inicioMes } }, select: { id: true } }),
    prisma.faturaAssinatura.findMany({
      where: { status: 'VENCIDA' },
      select: { clienteId: true, valor: true },
    }),
    prisma.cliente.findMany({
      where: { statusAssinatura: 'TRIAL', trialAte: { gte: agora, lte: em3dias } },
      select: { id: true, nome: true, trialAte: true },
      orderBy: { trialAte: 'asc' },
    }),
    prisma.chamado.count({ where: { status: 'ABERTO' } }),
  ]);

  // Funil do mes.
  const idsMes = cadastrosMes.map((c) => c.id);
  const [ativosMes, pagaramMes] = await Promise.all([
    idsComAtividade(idsMes),
    idsMes.length
      ? prisma.faturaAssinatura.groupBy({ by: ['clienteId'], where: { clienteId: { in: idsMes }, status: 'PAGA' }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);

  // Testes acabando sem uso (nenhuma venda nem agendamento).
  const comUso = await idsComAtividade(testesAcabando.map((c) => c.id));
  const semUso = testesAcabando.filter((c) => !comUso.has(c.id));

  const precisa = [];
  const clientesVencidos = new Set(faturasVencidas.map((f) => f.clienteId));
  if (faturasVencidas.length) {
    const total = faturasVencidas.reduce((t, f) => t + Number(f.valor || 0), 0);
    precisa.push({
      tipo: 'FATURAS_VENCIDAS', nivel: 'alto',
      texto: `${clientesVencidos.size} cliente(s) com mensalidade vencida (${faturasVencidas.length} fatura(s), ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`,
      acao: 'Ver cobrança', link: '/admin/assinaturas?filtro=ATRASADA',
    });
  }
  semUso.slice(0, 5).forEach((c) => {
    const dias = Math.max(0, Math.ceil((new Date(c.trialAte) - agora) / 86400000));
    precisa.push({
      tipo: 'TESTE_SEM_USO', nivel: 'medio',
      texto: `${c.nome}: teste acaba ${dias === 0 ? 'hoje' : `em ${dias} dia(s)`} e ainda não registrou venda nem agendamento`,
      acao: 'Abrir cliente', link: `/admin/assinaturas?cliente=${c.id}`,
    });
  });
  if (semUso.length > 5) {
    precisa.push({ tipo: 'TESTE_SEM_USO', nivel: 'medio', texto: `Mais ${semUso.length - 5} teste(s) acabando sem uso`, acao: 'Ver testes', link: '/admin/assinaturas?filtro=TRIAL' });
  }
  if (chamadosAbertos) {
    precisa.push({ tipo: 'CHAMADOS', nivel: 'medio', texto: `${chamadosAbertos} chamado(s) de suporte esperando resposta`, acao: 'Responder', link: '/admin/suporte' });
  }

  // Saude e limite do plano: best-effort (falha aqui nao derruba a tela).
  try {
    const { situacaoGeral, alertasDaSaude } = require('./saude');
    alertasDaSaude(await situacaoGeral()).forEach((t) => precisa.push({ tipo: 'SAUDE', nivel: 'medio', texto: t, acao: 'Ver saúde', link: '/admin/saude' }));
  } catch (e) {
    precisa.push({ tipo: 'SAUDE', nivel: 'alto', texto: 'Não foi possível medir a saúde do sistema agora', acao: 'Ver saúde', link: '/admin/saude' });
  }
  try {
    const { relatorioDeUso } = require('./uso');
    const uso = await relatorioDeUso();
    const acima = uso.linhas.filter((l) => l.acimaDoLimite.length);
    acima.slice(0, 3).forEach((l) => {
      const a = l.acimaDoLimite[0];
      const oque = a.limite === 'usuarios' ? 'usuários' : 'lembretes no mês';
      precisa.push({ tipo: 'ACIMA_DO_LIMITE', nivel: 'baixo', texto: `${l.nome} passou do limite do plano ${l.planoNome}: ${a.uso} de ${a.maximo} ${oque}. Oportunidade de upgrade`, acao: 'Ver uso', link: '/admin/uso' });
    });
    if (acima.length > 3) precisa.push({ tipo: 'ACIMA_DO_LIMITE', nivel: 'baixo', texto: `Mais ${acima.length - 3} cliente(s) acima do limite do plano`, acao: 'Ver uso', link: '/admin/uso' });
  } catch (e) {
    console.error('[visao-geral] uso', e?.message);
  }

  return {
    receitaPorMes: receitaPorMes(faturasPagas, agora),
    conversaoTeste: conversaoDoTeste(encerrados.map((c) => ({ statusAssinatura: c.statusAssinatura, pagou: c.faturasAssinatura.length > 0 }))),
    funil: {
      mes: `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`,
      cadastros: idsMes.length,
      ativaram: ativosMes.size,
      pagaram: pagaramMes.length,
    },
    precisaDeVoce: precisa,
  };
}

module.exports = { montarVisaoGeral, receitaPorMes, conversaoDoTeste };

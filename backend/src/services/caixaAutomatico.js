// Caixa automatico: na primeira venda do dia sem caixa aberto, abre um
// sozinho em vez de travar a venda (doc de fluxos, 21/11/2026: o PDV
// bloqueava a venda e mandava o lojista ir ao Financeiro abrir o caixa).
//
// Fundo do caixa novo = o que ficou no ultimo fechamento (contado, ou o
// esperado se nao contou). Origem AUTO_BOT: o cron das 00:01 fecha e reabre
// esse tipo sozinho, entao o lojista nunca precisa lembrar de abrir.
//
// Desligavel por tenant (Cliente.caixaAutomatico = false): ai volta a exigir
// abertura manual, como antes.
//
// SEMPRE chamar dentro de uma transacao que ja pegou lockClienteAdvisory —
// senao duas vendas simultaneas abririam dois caixas.

async function fundoDoUltimoFechamento(tx, clienteId) {
  const ultima = await tx.sessaoCaixa.findFirst({
    where: { clienteId, status: 'FECHADA' },
    orderBy: { fechadaEm: 'desc' },
    select: { saldoFinalReal: true, saldoFinalEsperado: true },
  });
  const valor = ultima?.saldoFinalReal ?? ultima?.saldoFinalEsperado ?? 0;
  return Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : 0;
}

/**
 * Devolve a sessao ABERTA do tenant, abrindo uma se nao houver.
 * @returns {Promise<{ sessao: object, abriuAgora: boolean }>}
 */
async function obterOuAbrirSessaoCaixa(tx, clienteId, { motivo = 'Aberto automaticamente na primeira venda do dia.' } = {}) {
  const aberta = await tx.sessaoCaixa.findFirst({
    where: { clienteId, status: 'ABERTA' },
    orderBy: { abertaEm: 'desc' },
  });
  if (aberta) return { sessao: aberta, abriuAgora: false };

  const sessao = await tx.sessaoCaixa.create({
    data: {
      clienteId,
      fundoCaixa: await fundoDoUltimoFechamento(tx, clienteId),
      status: 'ABERTA',
      origem: 'AUTO_BOT',
      observacaoAbertura: motivo,
    },
  });
  return { sessao, abriuAgora: true };
}

module.exports = { obterOuAbrirSessaoCaixa, fundoDoUltimoFechamento };

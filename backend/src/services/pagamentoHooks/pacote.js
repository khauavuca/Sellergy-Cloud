// Parcela de pacote paga: recalcula parcelasPagas, lanca a receita e gera a
// cobranca da proxima parcela (regra em src/agenda/pacotes.js).
// cobranca.refId = pacoteClienteId.

async function aoPagar(cobranca) {
  await require('../../agenda/pacotes').parcelaPaga(cobranca);
}

module.exports = { aoPagar };

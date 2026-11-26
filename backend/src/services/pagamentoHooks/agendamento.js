// Sinal do agendamento pago: marca sinalStatus=PAGO, confirma o horario,
// lanca a receita e avisa (regra em src/agenda/sinal.js).
// cobranca.refId = agendamentoId.

async function aoPagar(cobranca) {
  await require('../../agenda/sinal').sinalPago(cobranca);
}

module.exports = { aoPagar };

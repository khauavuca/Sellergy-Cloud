// Rotinas periodicas da frente C (carregadas por agenda/rotinasFase2.js no worker).
// "Emitir sozinho": nota das vendas pagas pra quem ligou no assistente fiscal.

const { emitirVendasPendentes } = require('./emissao');

module.exports = [
  {
    nome: 'fiscal-emitir-sozinho',
    intervaloMs: 2 * 60 * 1000,
    rodar: () => emitirVendasPendentes(),
  },
];

// Rotinas periodicas da frente D (painel admin), rodando no worker.
// Carregado por agenda/rotinasFase2.js. Formato: [{ nome, intervaloMs, rodar }].
//
// recarregar-planos: o worker gera faturas com o preco do plano, entao
// precisa do mesmo override de PlanoConfig que a API. A sincronizacao liga a
// carga imediata + aviso pelo Redis pub/sub; esta rotina e a rede de
// seguranca (a cada 5 min) caso o aviso se perca.

const { recarregarPlanos, iniciarSincronizacao } = require('../planos/sincronizacao');

iniciarSincronizacao();

module.exports = [
  { nome: 'recarregar-planos', intervaloMs: 5 * 60 * 1000, rodar: () => recarregarPlanos() },
];

// Rotinas periodicas da agenda (fase 2), carregadas por agenda/rotinasFase2.js
// no worker. Cada uma e idempotente e segura pra rodar em paralelo com a API.

const MINUTO = 60 * 1000;

module.exports = [
  {
    nome: 'encaixe-expirar',
    intervaloMs: MINUTO,
    rodar: () => require('./encaixe').expirarOfertas(),
  },
  {
    nome: 'sinal-expirar',
    intervaloMs: MINUTO,
    rodar: () => require('./sinal').expirarSinais(),
  },
  {
    nome: 'pacotes-vencer',
    intervaloMs: 60 * MINUTO,
    rodar: () => require('./pacotes').vencerPacotes(),
  },
  {
    nome: 'agenda-estornos',
    intervaloMs: 5 * MINUTO,
    rodar: () => require('./eventosAgenda').reconciliarEstornos(),
  },
];

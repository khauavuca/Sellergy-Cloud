// Regras puras da tela "Hoje" (celular da dona). Sem banco.

const VALOR_MINIMO_PIX = 1; // R$ 1,00
const VALOR_MAXIMO_PIX = 50000; // trava contra digito a mais no teclado

/** [inicio, fim) do dia local do processo (TZ=America/Sao_Paulo na imagem). */
function intervaloDoDia(agora = new Date()) {
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const fim = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + 1);
  return { inicio, fim };
}

/** Valor do teclado em centavos (inteiro) -> reais. Devolve { valor } ou { erro }. */
function valorDosCentavos(centavos) {
  const n = typeof centavos === 'string' && /^\d{1,9}$/.test(centavos) ? Number(centavos) : centavos;
  if (!Number.isInteger(n) || n <= 0) return { erro: 'Digite o valor da cobrança.' };
  const valor = n / 100;
  if (valor < VALOR_MINIMO_PIX) return { erro: 'O Pix precisa ser de pelo menos R$ 1,00.' };
  if (valor > VALOR_MAXIMO_PIX) return { erro: 'Valor alto demais para o Cobrar rápido. Use a tela de Pagamentos.' };
  return { valor };
}

const ROTULO_STATUS_AGENDA = {
  PENDING: 'Aguardando',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
};

function arred(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

module.exports = { intervaloDoDia, valorDosCentavos, ROTULO_STATUS_AGENDA, arred, VALOR_MINIMO_PIX, VALOR_MAXIMO_PIX };

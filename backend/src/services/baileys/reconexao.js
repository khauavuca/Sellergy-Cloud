// Politica de reconexao do Baileys — so aritmetica, sem socket nem banco, pra
// ser testavel (reconexao.test.js). Quem aplica e gerenciadorConexao.js.
//
// Por que existe: com N bots no mesmo worker, "tenta de novo em 3s pra
// sempre" vira N handshakes a cada 3s do mesmo IP quando o WhatsApp
// instabiliza — e reconectar todos os bots de uma vez no boot e a mesma
// coisa. Os dois sao o padrao classico de conta banida em canal nao oficial.

const BASE_MS = 3_000;
const TETO_MS = 5 * 60_000;
const JITTER_MS = 1_000;
// Somando os atrasos, o worker insiste por ~20 min antes de desistir e
// marcar o bot como DESCONECTADO (ai so um "Conectar" manual religa).
const MAX_TENTATIVAS = 10;

// Boot: religa em lotes pequenos com folga entre eles, em vez de todos juntos.
const BOOT_LOTE = 3;
const BOOT_INTERVALO_MS = 1_500;

/**
 * Atraso antes da tentativa `tentativa` (1 = primeira apos a queda).
 * Exponencial com teto + jitter, pra N bots nao baterem no mesmo instante.
 * @param {number} tentativa
 * @param {number} [aleatorio] injetavel (0..1) pra teste deterministico
 */
function calcularAtrasoReconexao(tentativa, aleatorio = Math.random()) {
  const expoente = Math.max(0, tentativa - 1);
  const exponencial = Math.min(TETO_MS, BASE_MS * 2 ** expoente);
  return exponencial + Math.floor(aleatorio * JITTER_MS);
}

function deveDesistir(tentativa) {
  return tentativa > MAX_TENTATIVAS;
}

/** Atraso do i-esimo bot na reconexao do boot (0-based). */
function atrasoNoBoot(indice) {
  return Math.floor(indice / BOOT_LOTE) * BOOT_INTERVALO_MS;
}

module.exports = {
  calcularAtrasoReconexao,
  deveDesistir,
  atrasoNoBoot,
  BASE_MS,
  TETO_MS,
  MAX_TENTATIVAS,
  BOOT_LOTE,
  BOOT_INTERVALO_MS,
};

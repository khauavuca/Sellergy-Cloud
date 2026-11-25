// Limpeza do suporte: apaga a conversa dos chamados resolvidos ha mais de 7
// dias (as fotos ja foram apagadas ao resolver). Roda a cada 6 horas.
// setTimeout encadeado, igual aos outros crons do projeto.
const { limparConversasVencidas } = require('../suporte/anexos');

const INTERVALO_MS = 6 * 60 * 60 * 1000;

async function rodar() {
  try {
    const n = await limparConversasVencidas();
    if (n) console.log(`[cronLimpezaSuporte] conversas apagadas: ${n}`);
  } catch (e) {
    console.error('[cronLimpezaSuporte]', e?.message);
  }
}

function iniciar() {
  // Primeira passada 2 min depois de subir (nao pesa o boot).
  setTimeout(function ciclo() {
    rodar().finally(() => setTimeout(ciclo, INTERVALO_MS));
  }, 2 * 60 * 1000);
  console.log('[cronLimpezaSuporte] Inicializado.');
}

module.exports = { iniciar, rodar };

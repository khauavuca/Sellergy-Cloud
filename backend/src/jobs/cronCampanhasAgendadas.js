// =====================================================================
// CAMPANHAS AGENDADAS — confere a cada minuto se alguma campanha agendada
// (Campanha.agendadoPara) ja chegou na hora e dispara.
// =====================================================================
// Rodar em mais de uma instancia da API e seguro: o disparo tira a campanha
// de RASCUNHO num updateMany condicional (services/campanhaDisparo.js), so
// uma instancia ganha. O envio em si continua na fila (worker), com o mesmo
// ritmo e as mesmas travas (WHATSAPP_ENVIO_REAL, SAIR) do "Enviar agora".

const prisma = require('../prisma');
const { dispararAgendadas } = require('../services/campanhaDisparo');
const { criarNotificacaoTenant } = require('../utils/notificacoes');

const INTERVALO_MS = 60_000;
let rodando = false;

async function tick() {
  if (rodando) return;
  rodando = true;
  try {
    const r = await dispararAgendadas({ avisar: (n) => criarNotificacaoTenant(prisma, n) });
    if (r.length) console.log(`[cron:campanhas-agendadas] ${r.filter((x) => x.ok).length}/${r.length} disparada(s)`);
  } catch (erro) {
    console.error('[cron:campanhas-agendadas]', erro?.message);
  } finally {
    rodando = false;
  }
}

function iniciar() {
  const t = setInterval(tick, INTERVALO_MS);
  if (t.unref) t.unref();
  console.log('[cron:campanhas-agendadas] agendado (a cada 1 min)');
}

module.exports = { iniciar, tick };

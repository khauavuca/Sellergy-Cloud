// Eventos de tempo real do Bot (socket.io). Antes eram io.emit GLOBAL com o
// bot inteiro — qualquer sessao logada, de qualquer cliente, recebia o QR
// Code (quem escanear primeiro pareia), o verify token da Meta e o prompt da
// IA. Agora:
//   - vai so pra sala do negocio (`cliente:<id>`) e pra sala `admins`
//     (ver io.on('connection') no index.js);
//   - sem os campos sensiveis. O QR continua chegando so pela sala do bot
//     (`bot:<id>`, evento baileys_status) ou por GET /bots/:id/canal/baileys/status.

const CAMPOS_SENSIVEIS = Object.freeze(['qrCodeAtual', 'verifyTokenCanal', 'iaPromptSistema']);

/** Copia do bot sem os campos sensiveis. Regra pura. */
function botParaEvento(bot) {
  if (!bot || typeof bot !== 'object') return bot;
  const copia = { ...bot };
  for (const campo of CAMPOS_SENSIVEIS) delete copia[campo];
  return copia;
}

/**
 * @param {import('socket.io').Server|undefined} io
 * @param {'bot_atualizado'|'bot_criado'|'bot_deletado'} evento
 * @param {string} clienteId  dono do bot
 * @param {object|string} dados  bot (sera limpo) ou id (bot_deletado)
 */
function emitirEventoBot(io, evento, clienteId, dados) {
  if (!io || !clienteId) return;
  const carga = typeof dados === 'object' ? botParaEvento(dados) : dados;
  io.to(`cliente:${clienteId}`).to('admins').emit(evento, carga);
}

module.exports = { botParaEvento, emitirEventoBot, CAMPOS_SENSIVEIS };

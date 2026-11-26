// Resolve o canal de WhatsApp conectado de um tenant e devolve um adapter
// pronto pra enviar. Junta a logica que estava repetida em campanhaService,
// cronDevolucoes e no webhook.
//
// IMPORTANTE: o canal BAILEYS (QR Code) so existe dentro do processo
// worker.js (e la que o socket vive). Chamado fora do worker, um tenant
// Baileys volta `null` com motivo SOCKET_INDISPONIVEL.

const prisma = require('../prisma');
const { carregarCredencialDecifrada } = require('../credenciais');
const { criarProvedorWhatsapp } = require('../adapters/whatsapp');

/**
 * @param {string} clienteId
 * @param {{ modo?: 'live'|'fixture' }} [opts]
 * @returns {Promise<{ ok: true, provedor: 'META_CLOUD'|'BAILEYS', botId: string, adapter: object }
 *                  | { ok: false, motivo: string }>}
 */
async function canalWhatsappDoTenant(clienteId, { modo = 'live' } = {}) {
  const bot = await prisma.bot.findFirst({
    where: { clienteId, identificadorCanal: { not: null } },
    select: { id: true, provedorCanal: true, identificadorCanal: true, credencialCanalId: true },
  });
  if (!bot) return { ok: false, motivo: 'SEM_WHATSAPP' };

  if (bot.provedorCanal === 'BAILEYS') {
    // require tardio: o gerenciador puxa o Baileys inteiro, que so o worker usa.
    const { obterSocket } = require('./baileys/gerenciadorConexao');
    const socket = obterSocket(bot.id);
    if (!socket) return { ok: false, motivo: 'SOCKET_INDISPONIVEL' };
    return { ok: true, provedor: 'BAILEYS', botId: bot.id, adapter: criarProvedorWhatsapp('BAILEYS', { modo, socket }) };
  }

  if (!bot.credencialCanalId) return { ok: false, motivo: 'SEM_CREDENCIAL' };
  const credencial = await carregarCredencialDecifrada({ credencialId: bot.credencialCanalId, clienteId }).catch(() => null);
  const token = credencial?.dados?.token || credencial?.dados?.accessToken || null;
  if (!token) return { ok: false, motivo: 'SEM_CREDENCIAL' };
  return {
    ok: true,
    provedor: 'META_CLOUD',
    botId: bot.id,
    adapter: criarProvedorWhatsapp('META_CLOUD', {
      credencial: { dados: { accessToken: token } }, identificadorCanal: bot.identificadorCanal, modo,
    }),
  };
}

/** "(11) 98888-7777" -> "5511988887777". Ja com DDI fica como esta. */
function telefoneParaWhatsapp(telefone) {
  const d = String(telefone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

module.exports = { canalWhatsappDoTenant, telefoneParaWhatsapp };

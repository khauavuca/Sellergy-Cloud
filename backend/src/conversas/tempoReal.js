// Tempo real da caixa de entrada do WhatsApp (só no processo da API).
//
//   - O navegador pede `join_conversas` (sem mandar id nenhum). O negócio vem
//     do usuário no BANCO (o socket já foi autenticado pelo cookie/JWT no
//     index.js); só entra quem pode ver as conversas (regras.podeVerConversas).
//     Sala: `conversas:<clienteId>`.
//   - API e worker publicam no Redis (conversas/servico.js -> "conversas:eventos");
//     aqui a gente assina e repassa pra sala do negócio.

const IORedis = require('ioredis');
const prisma = require('../prisma');
const sessaoUsuario = require('../seguranca/sessaoUsuario');
const { podeVerConversas } = require('./regras');
const { CANAL_EVENTOS } = require('./servico');

const TIPOS = new Set(['conversa_mensagem', 'conversa_mensagem_status', 'conversa_atualizada']);

/** Decide a sala do socket (ou null). Exportada pra teste. */
async function salaPermitida(dadosToken, { carregarUsuario = sessaoUsuario.carregarUsuario, carregarCliente } = {}) {
  if (!dadosToken?.id || dadosToken.suporte) return null;
  const usuario = await carregarUsuario(dadosToken.id);
  if (!sessaoUsuario.conferirSessao(dadosToken, usuario).ok) return null;
  const cliente = usuario?.clienteId
    ? await (carregarCliente || ((id) => prisma.cliente.findUnique({ where: { id }, select: { status: true, modulosLiberados: true } })))(usuario.clienteId)
    : null;
  return podeVerConversas(usuario, cliente) ? `conversas:${usuario.clienteId}` : null;
}

function ligarTempoReal(io) {
  io.on('connection', (socket) => {
    socket.on('join_conversas', async () => {
      try {
        const sala = await salaPermitida(socket.usuario);
        if (sala) socket.join(sala);
        socket.emit('conversas_pronto', { ok: Boolean(sala) });
      } catch (e) {
        console.error('[conversas join]', e?.message);
      }
    });
    socket.on('leave_conversas', () => {
      for (const sala of socket.rooms) if (sala.startsWith('conversas:')) socket.leave(sala);
    });
  });

  const assinante = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
  assinante.on('error', () => {}); // o ioredis reconecta sozinho
  assinante.subscribe(CANAL_EVENTOS).catch((e) => console.error('[conversas relay] falha ao assinar', e?.message));
  assinante.on('message', (_canal, texto) => {
    try {
      const { clienteId, tipo, dados } = JSON.parse(texto);
      if (typeof clienteId !== 'string' || !TIPOS.has(tipo)) return;
      io.to(`conversas:${clienteId}`).emit(tipo, dados);
    } catch (e) {
      console.error('[conversas relay] mensagem invalida', e?.message);
    }
  });
  return assinante;
}

module.exports = { ligarTempoReal, salaPermitida };

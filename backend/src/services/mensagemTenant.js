// Manda WhatsApp do numero do NEGOCIO (tenant) pro cliente final, de qualquer
// processo. No worker envia direto (o socket do QR Code mora la); na API
// enfileira em "whatsapp-tenant" e o worker envia.
//
//   await enviarMensagemTenant({ clienteId, para, texto, tipo: 'conversa'|'lembrete'|'campanha',
//                                enquete?: { pergunta, opcoes, registro?: { tipo, referenciaId } } })
//
// Respeita o opt-out (SAIR/PARAR) para tipo lembrete/campanha.

const prisma = require('../prisma');

async function enviarAgora({ clienteId, para, texto, tipo = 'conversa', enquete = null }) {
  const { canalWhatsappDoTenant, telefoneParaWhatsapp } = require('./whatsappDoTenant');
  const destino = telefoneParaWhatsapp(para);
  if (!destino) return { ok: false, motivo: 'SEM_TELEFONE' };
  if (tipo !== 'conversa') {
    const opt = await prisma.optOutWhatsapp.findUnique({ where: { clienteId_telefone: { clienteId, telefone: destino } } }).catch(() => null);
    if (opt) return { ok: false, motivo: 'OPT_OUT' };
  }
  const canal = await canalWhatsappDoTenant(clienteId);
  if (!canal.ok) return canal;
  const r = await canal.adapter.enviarTexto({ para: destino, texto, tipo });
  if (!r?.ok) return { ok: false, motivo: r?.erro || 'FALHA' };
  if (enquete && canal.provedor === 'BAILEYS' && typeof canal.adapter.enviarEnquete === 'function') {
    const e = await canal.adapter.enviarEnquete({ para: destino, pergunta: enquete.pergunta, opcoes: enquete.opcoes, tipo });
    if (e?.ok && e.mensagem && enquete.registro) {
      const { registrarEnquete } = require('./baileys/gerenciadorConexao');
      await registrarEnquete({ botId: canal.botId, mensagem: e.mensagem, ...enquete.registro });
    }
  }
  return { ok: true, canal: canal.provedor };
}

async function enviarMensagemTenant(msg) {
  if (process.env.SELLERGY_PROCESSO === 'worker') return enviarAgora(msg);
  const { enfileirarMensagemTenant } = require('../filas');
  await enfileirarMensagemTenant(msg);
  return { ok: true, enfileirado: true };
}

module.exports = { enviarMensagemTenant, enviarAgora };

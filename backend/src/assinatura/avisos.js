// =====================================================================
// AVISOS DA ASSINATURA — notificacao no sistema + WhatsApp do Sellergy.
// =====================================================================
// O WhatsApp sai do numero do PROPRIO Sellergy: um negocio cadastrado no
// sistema (PLATAFORMA_CLIENTE_ID) com o canal conectado (QR Code ou oficial).
// Vai pro telefone cadastrado do cliente (Cliente.telefone).
//
// Best-effort: se o canal nao estiver conectado ou o envio falhar, fica so a
// notificacao no sistema. O canal QR Code so existe no processo worker, por
// isso a regua roda la (ver worker.js).
// =====================================================================

const prisma = require('../prisma');
const { criarNotificacao } = require('../utils/notificacoes');

async function avisarNoSistema(clienteId, titulo, mensagem, dados = null) {
  await criarNotificacao(prisma, { clienteId, tipo: 'GENERICA', titulo, mensagem, link: '/app/plano', dados })
    .catch((e) => console.error('[assinatura/aviso]', e?.message));
}

async function avisarNoWhatsapp(clienteId, texto) {
  const plataformaId = process.env.PLATAFORMA_CLIENTE_ID;
  if (!plataformaId || plataformaId === clienteId) return { ok: false, motivo: 'SEM_CANAL_PLATAFORMA' };
  // Fora do worker o socket do QR Code nao existe: manda pra fila.
  if (process.env.SELLERGY_PROCESSO !== 'worker') {
    const { enfileirarAvisoPlataforma } = require('../filas');
    await enfileirarAvisoPlataforma(clienteId, texto).catch((e) => console.error('[assinatura/whatsapp] fila', e?.message));
    return { ok: true, enfileirado: true };
  }
  try {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { telefone: true } });
    const { canalWhatsappDoTenant, telefoneParaWhatsapp } = require('../services/whatsappDoTenant');
    const para = telefoneParaWhatsapp(cliente?.telefone);
    if (!para) return { ok: false, motivo: 'SEM_TELEFONE' };
    const canal = await canalWhatsappDoTenant(plataformaId);
    if (!canal.ok) return canal;
    return await canal.adapter.enviarTexto({ para, texto });
  } catch (e) {
    console.error('[assinatura/whatsapp]', e?.message);
    return { ok: false, motivo: 'FALHA' };
  }
}

/** Aviso nos dois lugares. `whatsapp` pode ser um texto diferente (mais curto). */
async function avisar(clienteId, { titulo, mensagem, whatsapp = null, dados = null }) {
  await avisarNoSistema(clienteId, titulo, mensagem, dados);
  if (whatsapp !== false) await avisarNoWhatsapp(clienteId, whatsapp || `*${titulo}*\n${mensagem}`);
}

module.exports = { avisar, avisarNoSistema, avisarNoWhatsapp };

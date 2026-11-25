// Manda WhatsApp do numero do NEGOCIO (tenant) pro cliente final, de qualquer
// processo. No worker envia direto (o socket do QR Code mora la); na API
// enfileira em "whatsapp-tenant" e o worker envia.
//
//   await enviarMensagemTenant({ clienteId, para, texto, tipo: 'conversa'|'lembrete'|'campanha',
//                                enquete?: { pergunta, opcoes, registro?: { tipo, referenciaId } } })
//
// Respeita o opt-out (SAIR/PARAR) para tipo lembrete/campanha.
//
// Caixa de entrada (tela /app/whatsapp): o que sai fica gravado na conversa do
// contato. Resposta da equipe pelo QR Code chega aqui com `mensagemConversaId`
// (ja gravada como PENDENTE pela rota): so atualiza o status dela.

const prisma = require('../prisma');

async function registrarNaConversa({ clienteId, destino, texto, tipo, canal, resultado, mensagemConversaId }) {
  const conversas = require('../conversas/servico');
  const { statusDoEnvio, origemDoTipo } = require('../conversas/regras');
  const status = statusDoEnvio(resultado);
  const erro = resultado?.ok ? null : resultado?.erro || resultado?.motivo || null;
  try {
    if (mensagemConversaId) {
      await conversas.atualizarStatusMensagem(mensagemConversaId, { status, erro, idExterno: resultado?.idMensagem });
      return;
    }
    if (!resultado) return;
    await conversas.registrarMensagem({
      clienteId, telefone: destino, texto, direcao: 'SAIDA', origem: origemDoTipo(tipo),
      canal: canal?.provedor, botId: canal?.botId, status, erro, idExterno: resultado?.idMensagem,
    });
  } catch (e) {
    console.error('[mensagemTenant] falha ao gravar na conversa', e?.message);
  }
}

async function enviarAgora({ clienteId, para, texto, tipo = 'conversa', enquete = null, mensagemConversaId = null }) {
  const { canalWhatsappDoTenant, telefoneParaWhatsapp } = require('./whatsappDoTenant');
  const destino = telefoneParaWhatsapp(para);
  if (!destino) return { ok: false, motivo: 'SEM_TELEFONE' };
  if (tipo !== 'conversa') {
    const opt = await prisma.optOutWhatsapp.findUnique({ where: { clienteId_telefone: { clienteId, telefone: destino } } }).catch(() => null);
    if (opt) return { ok: false, motivo: 'OPT_OUT' };
  }
  const canal = await canalWhatsappDoTenant(clienteId);
  if (!canal.ok) {
    // Socket fora do ar: o job tenta de novo, a mensagem segue PENDENTE.
    if (mensagemConversaId && canal.motivo !== 'SOCKET_INDISPONIVEL') {
      await registrarNaConversa({ clienteId, mensagemConversaId, resultado: { ok: false, erro: 'WhatsApp não conectado.' } });
    }
    return canal;
  }
  const r = await canal.adapter.enviarTexto({ para: destino, texto, tipo });
  await registrarNaConversa({ clienteId, destino, texto, tipo, canal, resultado: r, mensagemConversaId });
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

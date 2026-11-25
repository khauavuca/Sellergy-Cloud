// Le uma mensagem que chegou pelo webhook da API oficial da Meta e diz o que
// ela e (foto, video, audio, voz, documento, figurinha, localizacao, contato,
// reacao). Texto, botao e lista seguem pelo caminho de texto do bot. PURA.
//
// A Meta manda so o id da midia; quem chama baixa com whatsappCloud.baixarMidia.

function lerConteudoMeta(msg = {}) {
  const respondeAId = msg.context?.id || undefined;
  switch (msg.type) {
    case 'image':
      return { tipo: 'IMAGEM', texto: msg.image?.caption || '', midia: { id: msg.image?.id, mime: msg.image?.mime_type || 'image/jpeg' }, respondeAId };
    case 'video':
      return { tipo: 'VIDEO', texto: msg.video?.caption || '', midia: { id: msg.video?.id, mime: msg.video?.mime_type || 'video/mp4' }, respondeAId };
    case 'audio':
      return { tipo: msg.audio?.voice ? 'VOZ' : 'AUDIO', texto: '', midia: { id: msg.audio?.id, mime: msg.audio?.mime_type || 'audio/ogg' }, respondeAId };
    case 'document':
      return {
        tipo: 'DOCUMENTO', texto: msg.document?.caption || '', respondeAId,
        midia: { id: msg.document?.id, mime: msg.document?.mime_type || 'application/octet-stream', nome: msg.document?.filename || undefined },
      };
    case 'sticker':
      return { tipo: 'FIGURINHA', texto: '', midia: { id: msg.sticker?.id, mime: msg.sticker?.mime_type || 'image/webp' }, extra: { animada: Boolean(msg.sticker?.animated) } };
    case 'location':
      return {
        tipo: 'LOCALIZACAO', texto: msg.location?.name || msg.location?.address || '',
        extra: { lat: msg.location?.latitude, lng: msg.location?.longitude, nome: msg.location?.name || null, endereco: msg.location?.address || null },
      };
    case 'contacts': {
      const contatos = (msg.contacts || []).map((c) => ({
        nome: c.name?.formatted_name || [c.name?.first_name, c.name?.last_name].filter(Boolean).join(' ') || '',
        telefones: (c.phones || []).map((t) => String(t.wa_id || t.phone || '').replace(/\D/g, '')).filter(Boolean),
      }));
      return { tipo: 'CONTATO', texto: contatos.map((c) => c.nome).filter(Boolean).join(', '), extra: { contatos } };
    }
    case 'reaction':
      return { tipo: 'REACAO', texto: msg.reaction?.emoji || '', extra: { emoji: msg.reaction?.emoji || '', alvo: msg.reaction?.message_id || null } };
    default:
      return null; // text, button, interactive: caminho de texto
  }
}

module.exports = { lerConteudoMeta };

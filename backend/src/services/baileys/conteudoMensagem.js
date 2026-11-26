// Le o conteudo de uma mensagem do WhatsApp Web (Baileys) e diz o que ela e:
// texto, foto, video, GIF, audio, voz, documento, figurinha, localizacao,
// contato ou reacao. PURA (nao baixa nada; quem chama baixa a midia).

// O WhatsApp embrulha a mensagem em camadas (temporaria, visualizacao unica,
// documento com legenda, editada...). Desembrulha ate o conteudo de verdade.
function desembrulhar(message) {
  let m = message || {};
  for (let i = 0; i < 5; i += 1) {
    const dentro = m.ephemeralMessage?.message
      || m.viewOnceMessage?.message
      || m.viewOnceMessageV2?.message
      || m.viewOnceMessageV2Extension?.message
      || m.documentWithCaptionMessage?.message
      || m.editedMessage?.message?.protocolMessage?.editedMessage
      || null;
    if (!dentro) break;
    m = dentro;
  }
  return m;
}

const NOMES_TIPO_MIDIA = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];

/**
 * @returns {{ tipo: string, texto: string, midia?: { campo: string, mime: string, nome?: string, segundos?: number },
 *   extra?: object, respondeAId?: string, visualizacaoUnica?: boolean } | null}
 */
function lerConteudo(msg) {
  const bruto = msg?.message || {};
  const visualizacaoUnica = Boolean(bruto.viewOnceMessage || bruto.viewOnceMessageV2 || bruto.viewOnceMessageV2Extension);
  const m = desembrulhar(bruto);
  const contexto = m.extendedTextMessage?.contextInfo
    || NOMES_TIPO_MIDIA.map((k) => m[k]?.contextInfo).find(Boolean)
    || null;
  const respondeAId = contexto?.stanzaId || undefined;

  if (m.reactionMessage) {
    return { tipo: 'REACAO', texto: m.reactionMessage.text || '', extra: { emoji: m.reactionMessage.text || '', alvo: m.reactionMessage.key?.id || null } };
  }
  if (m.conversation || m.extendedTextMessage?.text) {
    return { tipo: 'TEXTO', texto: m.conversation || m.extendedTextMessage.text, respondeAId };
  }
  const resposta = m.buttonsResponseMessage?.selectedDisplayText || m.listResponseMessage?.title
    || m.templateButtonReplyMessage?.selectedDisplayText || m.interactiveResponseMessage?.body?.text;
  if (resposta) return { tipo: 'TEXTO', texto: resposta, respondeAId };

  if (m.imageMessage) {
    return { tipo: 'IMAGEM', texto: m.imageMessage.caption || '', midia: { campo: 'imageMessage', mime: m.imageMessage.mimetype || 'image/jpeg' }, respondeAId, visualizacaoUnica };
  }
  if (m.videoMessage) {
    const gif = Boolean(m.videoMessage.gifPlayback);
    return {
      tipo: gif ? 'GIF' : 'VIDEO', texto: m.videoMessage.caption || '', respondeAId, visualizacaoUnica,
      midia: { campo: 'videoMessage', mime: m.videoMessage.mimetype || 'video/mp4', segundos: m.videoMessage.seconds || undefined },
    };
  }
  if (m.audioMessage) {
    return {
      tipo: m.audioMessage.ptt ? 'VOZ' : 'AUDIO', texto: '', respondeAId,
      midia: { campo: 'audioMessage', mime: m.audioMessage.mimetype || 'audio/ogg', segundos: m.audioMessage.seconds || undefined },
    };
  }
  if (m.documentMessage) {
    return {
      tipo: 'DOCUMENTO', texto: m.documentMessage.caption || '', respondeAId,
      midia: { campo: 'documentMessage', mime: m.documentMessage.mimetype || 'application/octet-stream', nome: m.documentMessage.fileName || m.documentMessage.title || undefined },
    };
  }
  if (m.stickerMessage) {
    return { tipo: 'FIGURINHA', texto: '', midia: { campo: 'stickerMessage', mime: m.stickerMessage.mimetype || 'image/webp' }, extra: { animada: Boolean(m.stickerMessage.isAnimated) } };
  }
  const loc = m.locationMessage || m.liveLocationMessage;
  if (loc) {
    return {
      tipo: 'LOCALIZACAO', texto: loc.name || loc.address || loc.caption || '',
      extra: { lat: loc.degreesLatitude, lng: loc.degreesLongitude, nome: loc.name || null, endereco: loc.address || null, aoVivo: Boolean(m.liveLocationMessage) },
    };
  }
  if (m.contactMessage || m.contactsArrayMessage) {
    const lista = m.contactMessage ? [m.contactMessage] : (m.contactsArrayMessage.contacts || []);
    const contatos = lista.map((c) => ({
      nome: c.displayName || '',
      telefones: [...String(c.vcard || '').matchAll(/waid=(\d+)|TEL[^:]*:([+\d\s()-]+)/g)].map((x) => (x[1] || x[2] || '').replace(/\D/g, '')).filter(Boolean),
    }));
    return { tipo: 'CONTATO', texto: contatos.map((c) => c.nome).filter(Boolean).join(', '), extra: { contatos } };
  }
  return null; // enquete, protocolo, sistema: fora da conversa
}

module.exports = { desembrulhar, lerConteudo };

// =====================================================================
// SERVICO — ENVIO PELO WHATSAPP CLOUD API (Meta)
// =====================================================================
// Camada fina de envio de mensagens pelo WhatsApp Cloud API. Sem IA: o bot
// so dispara textos/menus/templates montados por regra fixa (ver botRouter).
//
// ESTADO (Fase 4 depende de App Review da Meta): o envio real exige um app
// Meta aprovado + token do tenant. Enquanto isso, o modo DRY_RUN registra o
// que SERIA enviado (log) e devolve sucesso simulado — assim o roteador de
// menu, FAQ e agendamento ja sao testaveis localmente com payload simulado.
//
// Liga o envio real definindo WHATSAPP_ENVIO_REAL=1 no ambiente.
// =====================================================================

const { fetchComRetentativa } = require('../utils/httpSeguro');

const GRAPH_VERSAO = process.env.WHATSAPP_GRAPH_VERSAO || 'v21.0';
const ENVIO_REAL = process.env.WHATSAPP_ENVIO_REAL === '1';

// Monta o corpo de uma mensagem de texto simples.
function corpoTexto(para, texto) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'text',
    text: { preview_url: false, body: texto },
  };
}

// Monta o corpo de uma mensagem de documento (o catalogo em PDF, por
// exemplo). `link` precisa ser publicamente acessivel — usar urlAssinada do
// storage/minio.js, nunca a URL interna do bucket.
function corpoDocumento(para, link, filename, caption) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'document',
    document: { link, filename, ...(caption ? { caption } : {}) },
  };
}

// Monta o corpo de um template HSM aprovado (usado em campanhas e em
// mensagens fora da janela de 24h). `componentes` segue o formato da Meta.
function corpoTemplate(para, nomeTemplate, idioma = 'pt_BR', componentes = []) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: para,
    type: 'template',
    template: {
      name: nomeTemplate,
      language: { code: idioma },
      ...(componentes.length ? { components: componentes } : {}),
    },
  };
}

// Faz o POST no Graph API. Isola o fetch pra um unico ponto (DRY_RUN cobre).
async function enviar({ phoneNumberId, token, corpo }) {
  if (!phoneNumberId || !token) {
    return { ok: false, simulado: false, erro: 'phoneNumberId/token ausentes' };
  }

  if (!ENVIO_REAL) {
    // Modo simulado — nao chama a Meta. Loga o destino e o tipo.
    console.log('[whatsappCloud:DRY_RUN]', phoneNumberId, '->', corpo.to, `(${corpo.type})`);
    return { ok: true, simulado: true, corpo };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSAO}/${phoneNumberId}/messages`;
  try {
    // Timeout + retentativa com backoff (429/5xx) — ver utils/httpSeguro.js.
    const resp = await fetchComRetentativa(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Nunca vaza o token; loga so o erro da Meta.
      console.error('[whatsappCloud] envio falhou', resp.status, dados?.error?.message);
      return { ok: false, simulado: false, status: resp.status, erro: dados?.error?.message || 'falha no envio' };
    }
    return { ok: true, simulado: false, idMensagem: dados?.messages?.[0]?.id || null };
  } catch (erro) {
    console.error('[whatsappCloud] excecao no envio', erro?.message);
    return { ok: false, simulado: false, erro: erro?.message || 'excecao no envio' };
  }
}

// Atalho: envia texto simples.
function enviarTexto({ phoneNumberId, token, para, texto }) {
  return enviar({ phoneNumberId, token, corpo: corpoTexto(para, texto) });
}

// Atalho: envia template HSM (campanhas / fora da janela de 24h).
function enviarTemplate({ phoneNumberId, token, para, nomeTemplate, idioma, componentes }) {
  return enviar({ phoneNumberId, token, corpo: corpoTemplate(para, nomeTemplate, idioma, componentes) });
}

// Atalho: envia documento (catalogo em PDF).
function enviarDocumento({ phoneNumberId, token, para, link, filename, caption }) {
  return enviar({ phoneNumberId, token, corpo: corpoDocumento(para, link, filename, caption) });
}

// ---------- midia (foto, video, audio, documento, figurinha) ----------
// Tipo do sistema -> tipo da Meta.
const TIPO_META = { IMAGEM: 'image', GIF: 'video', VIDEO: 'video', AUDIO: 'audio', VOZ: 'audio', DOCUMENTO: 'document', FIGURINHA: 'sticker' };

/** Sobe o arquivo pra Meta e devolve o media id. */
async function subirMidia({ phoneNumberId, token, buffer, mime, nome }) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([buffer], { type: mime }), nome || 'arquivo');
  const resp = await fetchComRetentativa(`https://graph.facebook.com/${GRAPH_VERSAO}/${phoneNumberId}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || !dados?.id) throw new Error(dados?.error?.message || `falha ao subir midia (${resp.status})`);
  return dados.id;
}

/** Envia midia: sobe o arquivo e manda a mensagem com o id. */
async function enviarMidia({ phoneNumberId, token, para, tipo, buffer, mime, nome, legenda, respondeAId }) {
  const tipoMeta = TIPO_META[tipo];
  if (!tipoMeta) return { ok: false, erro: `Tipo de mídia não suportado: ${tipo}` };
  if (!ENVIO_REAL) {
    console.log('[whatsappCloud:DRY_RUN]', phoneNumberId, '->', para, `(${tipoMeta}, ${buffer?.length || 0} bytes)`);
    return { ok: true, simulado: true };
  }
  if (!phoneNumberId || !token) return { ok: false, erro: 'phoneNumberId/token ausentes' };
  try {
    const id = await subirMidia({ phoneNumberId, token, buffer, mime, nome });
    const objeto = { id };
    // Audio e figurinha nao aceitam legenda na Meta.
    if (legenda && ['image', 'video', 'document'].includes(tipoMeta)) objeto.caption = legenda;
    if (tipoMeta === 'document' && nome) objeto.filename = nome;
    const corpo = { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: tipoMeta, [tipoMeta]: objeto };
    if (respondeAId) corpo.context = { message_id: respondeAId };
    return enviar({ phoneNumberId, token, corpo });
  } catch (e) {
    console.error('[whatsappCloud] midia falhou', e?.message);
    return { ok: false, erro: e?.message || 'falha ao enviar mídia' };
  }
}

/** Baixa uma midia recebida (o webhook so manda o id). Devolve { buffer, mime }. */
async function baixarMidia({ token, mediaId }) {
  const info = await fetchComRetentativa(`https://graph.facebook.com/${GRAPH_VERSAO}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  const meta = await info.json().catch(() => ({}));
  if (!info.ok || !meta?.url) throw new Error(meta?.error?.message || `midia ${mediaId} indisponivel`);
  const arq = await fetchComRetentativa(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!arq.ok) throw new Error(`download da midia falhou (${arq.status})`);
  return { buffer: Buffer.from(await arq.arrayBuffer()), mime: meta.mime_type || arq.headers.get('content-type') || 'application/octet-stream' };
}

/** Reacao com emoji a uma mensagem. */
function enviarReacao({ phoneNumberId, token, para, alvoId, emoji }) {
  return enviar({ phoneNumberId, token, corpo: { messaging_product: 'whatsapp', to: para, type: 'reaction', reaction: { message_id: alvoId, emoji: emoji || '' } } });
}

/** Marca como lida e (opcional) mostra "digitando..." pro cliente. */
async function marcarLida({ phoneNumberId, token, idMensagem, digitando = false }) {
  if (!ENVIO_REAL || !phoneNumberId || !token || !idMensagem) return { ok: true, simulado: !ENVIO_REAL };
  const corpo = { messaging_product: 'whatsapp', status: 'read', message_id: idMensagem };
  if (digitando) corpo.typing_indicator = { type: 'text' };
  const r = await fetchComRetentativa(`https://graph.facebook.com/${GRAPH_VERSAO}/${phoneNumberId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  }).catch(() => null);
  return { ok: Boolean(r?.ok) };
}

module.exports = {
  enviar,
  subirMidia,
  enviarMidia,
  baixarMidia,
  enviarReacao,
  marcarLida,
  enviarTexto,
  enviarTemplate,
  enviarDocumento,
  corpoTexto,
  corpoTemplate,
  corpoDocumento,
  ENVIO_REAL,
};

// Midia das conversas do WhatsApp (foto, video, GIF, audio, voz, documento,
// figurinha). Guardada no MinIO privado e SEM prazo de apagar: o dono pediu
// que essas informacoes nunca sejam perdidas. O navegador nunca recebe URL do
// MinIO: busca pela API, com login, e a API confere de quem e a conversa.
const crypto = require('crypto');
const { upload, baixar } = require('../storage/minio');

const MB = 1024 * 1024;
// Limites das proprias APIs (a Meta recusa acima disso; o Baileys aguenta
// mais, mas mantemos o mesmo teto pra nao encher o storage com arquivo gigante).
const LIMITES = {
  IMAGEM: 5 * MB, GIF: 16 * MB, VIDEO: 16 * MB, AUDIO: 16 * MB, VOZ: 16 * MB,
  DOCUMENTO: 100 * MB, FIGURINHA: 1 * MB,
};

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/webm': 'webm', 'audio/wav': 'wav',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
};

// O que pode ser aberto direto no navegador (o resto sempre baixa como anexo,
// nunca roda: HTML/SVG/JS mandados pelo cliente nao executam no sistema).
const ABRE_NO_NAVEGADOR = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime|3gpp)|audio\/|application\/pdf$)/;

function mimeBase(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
}

function extensao(mime, nome) {
  const m = mimeBase(mime);
  if (EXT[m]) return EXT[m];
  const doNome = String(nome || '').match(/\.([a-z0-9]{1,6})$/i)?.[1];
  return doNome ? doNome.toLowerCase() : 'bin';
}

/** Tipo da mensagem pelo mime (quando a API nao diz). PURA. */
function tipoPeloMime(mime, { voz = false, gif = false, figurinha = false } = {}) {
  const m = mimeBase(mime);
  if (figurinha) return 'FIGURINHA';
  if (m.startsWith('image/')) return m === 'image/gif' ? 'GIF' : 'IMAGEM';
  if (m.startsWith('video/')) return gif ? 'GIF' : 'VIDEO';
  if (m.startsWith('audio/')) return voz ? 'VOZ' : 'AUDIO';
  return 'DOCUMENTO';
}

/** Rotulo curto pra lista de conversas e notificacao. PURA. */
function rotuloDoTipo(tipo) {
  return {
    IMAGEM: '📷 Foto', VIDEO: '🎬 Vídeo', GIF: 'GIF', AUDIO: '🎵 Áudio', VOZ: '🎤 Mensagem de voz',
    DOCUMENTO: '📄 Documento', FIGURINHA: 'Figurinha', LOCALIZACAO: '📍 Localização', CONTATO: '👤 Contato',
    REACAO: 'Reagiu', NOTA: 'Nota interna',
  }[tipo] || '';
}

/** Guarda o arquivo e devolve os campos pra gravar na mensagem. */
async function guardar({ clienteId, conversaId, buffer, mime, nome, tipo }) {
  if (!buffer?.length) throw Object.assign(new Error('Arquivo vazio.'), { status: 422 });
  const limite = LIMITES[tipo] || LIMITES.DOCUMENTO;
  if (buffer.length > limite) throw Object.assign(new Error(`Arquivo grande demais (máximo ${Math.round(limite / MB)} MB).`), { status: 413 });
  const m = mimeBase(mime);
  const chave = `whatsapp/${clienteId}/${conversaId || 'sem-conversa'}/${crypto.randomBytes(12).toString('hex')}.${extensao(m, nome)}`;
  await upload({ key: chave, body: buffer, contentType: m, cacheControl: 'private, max-age=0' });
  return {
    midiaChave: chave, midiaMime: m, midiaTamanho: buffer.length,
    midiaNome: nome ? String(nome).replace(/[\r\n"\\/]/g, '_').slice(0, 160) : null,
  };
}

/** Le o arquivo guardado como Buffer (o worker usa pra mandar pelo Baileys). */
async function lerBuffer(chave) {
  const { corpo } = await baixar(chave);
  const partes = [];
  for await (const p of corpo) partes.push(p);
  return Buffer.concat(partes);
}

/** Repassa o arquivo ao navegador. Quem chama ja conferiu o acesso. */
async function enviarAoNavegador(res, mensagem, { baixarArquivo = false } = {}) {
  if (!mensagem?.midiaChave) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  try {
    const { corpo, tamanho } = await baixar(mensagem.midiaChave);
    const mime = mimeBase(mensagem.midiaMime);
    const inline = !baixarArquivo && ABRE_NO_NAVEGADOR.test(mime);
    const nome = mensagem.midiaNome || `arquivo.${extensao(mime)}`;
    res.setHeader('Content-Type', inline ? mime : 'application/octet-stream');
    if (tamanho) res.setHeader('Content-Length', String(tamanho));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(nome)}"`);
    corpo.pipe(res);
  } catch (e) {
    console.error('[conversas/midia]', e?.message);
    if (!res.headersSent) res.status(404).json({ erro: 'Arquivo não encontrado.' });
  }
}

/**
 * Converte o audio gravado no navegador (WEBM/Opus no Chrome) pro formato da
 * mensagem de voz do WhatsApp: OGG/Opus mono. Sem isso a "bolinha" nao toca
 * no celular. Usa o ffmpeg empacotado (ffmpeg-static).
 */
function converterParaVoz(buffer) {
  const { spawn } = require('child_process');
  const ffmpeg = require('ffmpeg-static');
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1']);
    const saida = [];
    let erro = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('conversao de audio demorou demais')); }, 30000);
    p.stdout.on('data', (d) => saida.push(d));
    p.stderr.on('data', (d) => { erro += d.toString().slice(0, 500); });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && saida.length) resolve(Buffer.concat(saida));
      else reject(new Error(`ffmpeg falhou (${code}): ${erro}`));
    });
    p.stdin.on('error', () => {});
    p.stdin.end(buffer);
  });
}

module.exports = { converterParaVoz, LIMITES, mimeBase, extensao, tipoPeloMime, rotuloDoTipo, guardar, lerBuffer, enviarAoNavegador };

// Validacao de upload pelo CONTEUDO (assinatura de bytes / "magic numbers").
//
// O multer (middlewares/upload.middleware.js) so olha o mimetype e a extensao,
// que vem do navegador e qualquer um falsifica: um .exe renomeado pra .jpg com
// Content-Type image/jpeg passaria. Este middleware roda DEPOIS do multer
// (memoryStorage, o arquivo esta em req.file.buffer) e:
//  - confere os primeiros bytes contra os formatos aceitos de cada tipo;
//  - bloqueia executaveis (Windows PE, ELF, Mach-O, script com #!), arquivos
//    compactados, PDF, HTML, SVG e qualquer coisa com <script / <?php embutido
//    (poliglotas: imagem valida com codigo escondido nos metadados);
//  - limita tamanho (de novo, defesa em profundidade) e as dimensoes da imagem
//    (anti "bomba de pixels": PNG pequeno de 50.000 x 50.000 que trava quem abre);
//  - corrige req.file.mimetype pro tipo REAL detectado (o handler usa isso pra
//    escolher a extensao) e gera um nome aleatorio em req.file.nomeSeguro.
//
// Uso (logo depois do multer, na mesma rota):
//   roteador.post('/x', aceitarUmaImagem('imagem'), uploadSeguro('imagem'), handler)
//   roteador.post('/y', aceitarUmCsv('arquivo'),   uploadSeguro('csv'),    handler)
//   roteador.post('/z', aceitarUmXml('arquivo'),   uploadSeguro('xml'),    handler)

const crypto = require('crypto');

const MB = 1024 * 1024;

// Limite de pixels por imagem (40 MP ~ 8000 x 5000) e de lado.
const MAX_PIXELS = 40 * 1000 * 1000;
const MAX_LADO = 12000;

const PERFIS = {
  imagem: { tamanhoMax: 5 * MB, tipos: ['image/jpeg', 'image/png', 'image/webp'] },
  csv: { tamanhoMax: 2 * MB, tipos: ['text/csv'] },
  xml: { tamanhoMax: 4 * MB, tipos: ['application/xml'] },
};

const EXTENSOES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'application/xml': 'xml',
};

// Assinaturas que NUNCA sao aceitas, em qualquer perfil.
const PROIBIDOS = [
  { nome: 'executavel Windows (PE/MZ)', bytes: [0x4d, 0x5a] },
  { nome: 'executavel Linux (ELF)', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { nome: 'executavel macOS (Mach-O)', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { nome: 'executavel macOS (Mach-O)', bytes: [0xce, 0xfa, 0xed, 0xfe] },
  { nome: 'executavel macOS (Mach-O)', bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { nome: 'executavel macOS (Mach-O)', bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { nome: 'binario Java/Mach-O universal', bytes: [0xca, 0xfe, 0xba, 0xbe] },
  { nome: 'script (#!)', bytes: [0x23, 0x21] },
  { nome: 'arquivo compactado (ZIP/JAR/DOCX/APK)', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { nome: 'arquivo compactado (RAR)', bytes: [0x52, 0x61, 0x72, 0x21] },
  { nome: 'arquivo compactado (7z)', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { nome: 'arquivo compactado (gzip)', bytes: [0x1f, 0x8b] },
  { nome: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46] },
  { nome: 'documento OLE (DOC/XLS/MSI)', bytes: [0xd0, 0xcf, 0x11, 0xe0] },
  { nome: 'WebAssembly', bytes: [0x00, 0x61, 0x73, 0x6d] },
];

// Trechos de codigo que nao tem o que fazer dentro de imagem/CSV/NF-e.
// (O XML de NF-e nao tem HTML; o CSV de fornecedores tambem nao.)
// Todos tem 5+ bytes: numa imagem (binario aleatorio) a chance de casar por
// acaso e desprezivel; padroes curtos (ex.: "<%") dariam falso positivo.
const TRECHOS_PERIGOSOS = [
  /<\s*script/i,
  /<\?php/i,
  /<\s*svg[\s>]/i,
  /<\s*html[\s>]/i,
  /<\s*iframe/i,
  /<\s*object/i,
  /<\s*embed/i,
  /javascript\s*:/i,
  /\bon(load|error|click|mouseover)\s*=/i,
];

function comecaCom(buf, bytes, deslocamento = 0) {
  if (buf.length < deslocamento + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[deslocamento + i] !== bytes[i]) return false;
  }
  return true;
}

function ascii(buf, inicio, fim) {
  return buf.subarray(inicio, fim).toString('latin1');
}

// ---------------------------------------------------------------------------
// Deteccao de imagem + dimensoes
// ---------------------------------------------------------------------------

function dimensoesPng(buf) {
  // Assinatura (8) + tamanho do chunk (4) + "IHDR" (4) + largura (4) + altura (4)
  if (buf.length < 24 || ascii(buf, 12, 16) !== 'IHDR') return null;
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

function dimensoesJpeg(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marcador = buf[i + 1];
    if (marcador === 0xda) return null; // inicio dos dados (SOS) sem SOF antes
    // SOF0..SOF15, exceto DHT (C4), JPG (C8) e DAC (CC)
    if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
      return { altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
    }
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7) || marcador === 0xff) {
      i += marcador === 0xff ? 1 : 2;
      continue;
    }
    const tamanho = buf.readUInt16BE(i + 2);
    if (tamanho < 2) return null;
    i += 2 + tamanho;
  }
  return null;
}

function dimensoesWebp(buf) {
  const tipo = ascii(buf, 12, 16);
  if (tipo === 'VP8X' && buf.length >= 30) {
    return { largura: 1 + buf.readUIntLE(24, 3), altura: 1 + buf.readUIntLE(27, 3) };
  }
  if (tipo === 'VP8 ' && buf.length >= 30) {
    return { largura: buf.readUInt16LE(26) & 0x3fff, altura: buf.readUInt16LE(28) & 0x3fff };
  }
  if (tipo === 'VP8L' && buf.length >= 25) {
    const b = buf.readUInt32LE(21);
    return { largura: (b & 0x3fff) + 1, altura: ((b >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function detectarImagem(buf) {
  if (comecaCom(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', dimensoes: dimensoesJpeg(buf) };
  if (comecaCom(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', dimensoes: dimensoesPng(buf) };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return { mime: 'image/webp', dimensoes: dimensoesWebp(buf) };
  return null;
}

// ---------------------------------------------------------------------------
// Texto (CSV / XML)
// ---------------------------------------------------------------------------

function decodificarTexto(buf) {
  let inicio = 0;
  if (comecaCom(buf, [0xef, 0xbb, 0xbf])) inicio = 3; // BOM UTF-8
  if (comecaCom(buf, [0xff, 0xfe]) || comecaCom(buf, [0xfe, 0xff])) {
    return { erro: 'Arquivo em UTF-16; salve como UTF-8.' };
  }
  const corpo = buf.subarray(inicio);
  if (corpo.includes(0x00)) return { erro: 'Arquivo binario (byte nulo) nao e texto.' };
  return { texto: corpo.toString('utf8') };
}

// ---------------------------------------------------------------------------
// Inspecao principal (pura, testavel sem Express)
// ---------------------------------------------------------------------------

/**
 * Inspeciona o conteudo de um arquivo enviado.
 * @param {Buffer} buf
 * @param {'imagem'|'csv'|'xml'} perfil
 * @param {{tamanhoMax?: number}} [opcoes]
 * @returns {{ok: true, mime: string, extensao: string} | {ok: false, motivo: string, status: number}}
 */
function inspecionarArquivo(buf, perfil, opcoes = {}) {
  const config = PERFIS[perfil];
  if (!config) throw new Error(`Perfil de upload desconhecido: ${perfil}`);
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, status: 400, motivo: 'Arquivo vazio.' };
  }
  const tamanhoMax = opcoes.tamanhoMax || config.tamanhoMax;
  if (buf.length > tamanhoMax) {
    return { ok: false, status: 413, motivo: `Arquivo excede ${Math.round(tamanhoMax / MB)}MB.` };
  }

  const proibido = PROIBIDOS.find((p) => comecaCom(buf, p.bytes));
  if (proibido) {
    return { ok: false, status: 415, motivo: `Conteudo nao permitido (${proibido.nome}).` };
  }

  if (perfil === 'imagem') {
    const imagem = detectarImagem(buf);
    if (!imagem) {
      return { ok: false, status: 415, motivo: 'O conteudo nao e uma imagem JPEG, PNG ou WebP.' };
    }
    if (!imagem.dimensoes || !imagem.dimensoes.largura || !imagem.dimensoes.altura) {
      return { ok: false, status: 415, motivo: 'Imagem corrompida (sem dimensoes legiveis).' };
    }
    const { largura, altura } = imagem.dimensoes;
    if (largura > MAX_LADO || altura > MAX_LADO || largura * altura > MAX_PIXELS) {
      return { ok: false, status: 413, motivo: `Imagem grande demais (${largura}x${altura}).` };
    }
    // Poliglota: codigo escondido em metadados (EXIF/comentario) de imagem valida.
    const bruto = buf.toString('latin1');
    if (TRECHOS_PERIGOSOS.some((re) => re.test(bruto))) {
      return { ok: false, status: 415, motivo: 'Imagem contem codigo embutido.' };
    }
    return { ok: true, mime: imagem.mime, extensao: EXTENSOES[imagem.mime] };
  }

  const { texto, erro } = decodificarTexto(buf);
  if (erro) return { ok: false, status: 415, motivo: erro };
  if (TRECHOS_PERIGOSOS.some((re) => re.test(texto))) {
    return { ok: false, status: 415, motivo: 'Arquivo contem HTML/script.' };
  }

  if (perfil === 'xml') {
    const inicio = texto.trimStart();
    if (!inicio.startsWith('<')) {
      return { ok: false, status: 415, motivo: 'O conteudo nao e XML.' };
    }
    // Anti-XXE / "billion laughs" (o utils/nfeSeguro.js tambem recusa).
    if (/<!DOCTYPE|<!ENTITY/i.test(texto)) {
      return { ok: false, status: 415, motivo: 'XML com DOCTYPE/ENTITY nao e aceito.' };
    }
    return { ok: true, mime: 'application/xml', extensao: 'xml' };
  }

  // CSV: texto que nao comeca com "<" (nao e HTML/XML disfarcado).
  if (texto.trimStart().startsWith('<')) {
    return { ok: false, status: 415, motivo: 'O conteudo nao e CSV.' };
  }
  return { ok: true, mime: 'text/csv', extensao: 'csv' };
}

/** Nome aleatorio (sem nada vindo do usuario) pra gravar o arquivo. */
function nomeAleatorio(extensao) {
  return `${crypto.randomBytes(16).toString('hex')}.${extensao}`;
}

/**
 * Middleware Express. Roda DEPOIS do multer (memoryStorage).
 * Sem arquivo, deixa passar (o handler decide se o campo e obrigatorio).
 * @param {'imagem'|'csv'|'xml'} perfil
 * @param {{tamanhoMax?: number}} [opcoes]
 */
function uploadSeguro(perfil, opcoes = {}) {
  if (!PERFIS[perfil]) throw new Error(`Perfil de upload desconhecido: ${perfil}`);

  return function validarUpload(req, res, next) {
    const arquivos = [];
    if (req.file) arquivos.push(req.file);
    if (Array.isArray(req.files)) arquivos.push(...req.files);
    else if (req.files && typeof req.files === 'object') {
      for (const lista of Object.values(req.files)) arquivos.push(...lista);
    }

    for (const arquivo of arquivos) {
      if (!Buffer.isBuffer(arquivo.buffer)) {
        // Sem buffer = multer em disco; este middleware so cobre memoryStorage.
        return res.status(500).json({ erro: 'Upload mal configurado no servidor.' });
      }
      const resultado = inspecionarArquivo(arquivo.buffer, perfil, opcoes);
      if (!resultado.ok) {
        console.warn('[upload-seguro] recusado', {
          perfil,
          motivo: resultado.motivo,
          tamanho: arquivo.buffer.length,
          ip: req.ip,
          usuarioId: req.usuario && req.usuario.id,
        });
        return res.status(resultado.status).json({ erro: resultado.motivo });
      }
      arquivo.mimeDeclarado = arquivo.mimetype;
      arquivo.mimetype = resultado.mime;
      arquivo.extensaoSegura = resultado.extensao;
      arquivo.nomeSeguro = nomeAleatorio(resultado.extensao);
    }
    return next();
  };
}

module.exports = {
  uploadSeguro,
  inspecionarArquivo,
  nomeAleatorio,
  PERFIS,
  MAX_PIXELS,
  MAX_LADO,
};

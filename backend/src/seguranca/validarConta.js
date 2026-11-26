// =====================================================================
// Validacoes da conta: perfil, senha, marca, horario e endereco publico.
// Regras PURAS (sem banco) usadas por auth.routes, conta.routes e a equipe.
// =====================================================================

const SENHA_MINIMA = 8; // a mesma em todo lugar (cadastro, convite, equipe, troca)
const SENHA_MAXIMA = 128;
const NOME_MAXIMO = 120;
const EMAIL_MAXIMO = 120;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
// Imagem guardada como data-URL: so formatos de bitmap (SVG pode ter script).
const DATA_URL_IMAGEM_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const IMAGEM_MAXIMA = 400 * 1024; // ~300 KB de imagem (o front reduz antes)

// Enderecos que viram rota/subdominio do sistema: nenhum negocio pode usar.
const SLUGS_RESERVADOS = new Set([
  'admin', 'api', 'app', 'www', 'crm', 'painel', 'ajuda', 'suporte', 'login', 'entrar', 'sair',
  'cadastro', 'conta', 'publico', 'agendar', 'convite', 'loja', 'static', 'assets', 'sellergy',
  'sellergycloud', 'root', 'sistema', 'status', 'docs', 'blog', 'mail', 'email', 'webhook', 'webhooks',
]);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function texto(v) { return typeof v === 'string' ? v : null; }

/** E-mail limpo (trim + minusculas) ou null quando nao e texto. PURA. */
function normalizarEmail(email) {
  const t = texto(email);
  return t === null ? null : t.trim().toLowerCase();
}

function emailValido(email) {
  return typeof email === 'string' && email.length <= EMAIL_MAXIMO && EMAIL_RE.test(email);
}

/** Nome de pessoa/negocio: 2 a 120 caracteres, sem ser so espaco. */
function validarNome(nome, { campo = 'nome', maximo = NOME_MAXIMO } = {}) {
  const t = texto(nome);
  if (t === null || t.trim().length < 2) return { erro: 'Informe o nome (pelo menos 2 letras).', campos: [campo] };
  if (t.trim().length > maximo) return { erro: `O nome pode ter no máximo ${maximo} caracteres.`, campos: [campo] };
  return { valor: t.trim() };
}

/** Senha nova: 8 a 128 caracteres e nao pode ser so espacos. Devolve a mensagem de erro ou null. */
function erroSenhaNova(senha) {
  if (typeof senha !== 'string' || senha.length < SENHA_MINIMA) return `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`;
  if (senha.length > SENHA_MAXIMA) return `A senha pode ter no máximo ${SENHA_MAXIMA} caracteres.`;
  if (!senha.trim()) return 'A senha não pode ser só espaços.';
  return null;
}

function prefixosArmazenamento(env = process.env) {
  const base = (env.MINIO_PUBLIC_ENDPOINT || env.MINIO_ENDPOINT || '').replace(/\/+$/, '');
  const bucket = env.MINIO_BUCKET_MIDIA || 'sellergy-midia';
  return base ? [`${base}/${bucket}/`] : [];
}

/**
 * Foto/logo: vazio (remove), data-URL de imagem (png/jpg/webp/gif) ate o
 * tamanho maximo, ou URL do nosso armazenamento. Recusa javascript:, SVG e
 * link externo. Devolve { valor } ou { erro }.
 */
function validarImagem(valor, { env = process.env } = {}) {
  if (valor === null || valor === undefined || valor === '') return { valor: null };
  if (typeof valor !== 'string') return { erro: 'Imagem inválida.' };
  if (valor.length > IMAGEM_MAXIMA) return { erro: 'Imagem muito grande. Use uma imagem de até 300 KB.' };
  if (DATA_URL_IMAGEM_RE.test(valor)) return { valor };
  if (/^https?:\/\//i.test(valor) && !/[\s"'<>]/.test(valor) && prefixosArmazenamento(env).some((p) => valor.startsWith(p))) {
    return { valor };
  }
  return { erro: 'Imagem inválida. Envie um arquivo PNG, JPG ou WEBP.' };
}

const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function minutos(h) { const [a, b] = h.split(':').map(Number); return a * 60 + b; }

/**
 * Horario de funcionamento: { abertura 'HH:MM', fechamento 'HH:MM' (depois da
 * abertura), dias [0-6] nao vazio }. Devolve { dados } ou { erro, campos }.
 */
function validarHorario(corpo = {}) {
  const { abertura, fechamento, dias } = corpo || {};
  if (typeof abertura !== 'string' || !HORA_RE.test(abertura)) return { erro: 'Horário de abertura inválido (use HH:MM, de 00:00 a 23:59).', campos: ['abertura'] };
  if (typeof fechamento !== 'string' || !HORA_RE.test(fechamento)) return { erro: 'Horário de fechamento inválido (use HH:MM, de 00:00 a 23:59).', campos: ['fechamento'] };
  if (minutos(fechamento) <= minutos(abertura)) return { erro: 'O fechamento precisa ser depois da abertura.', campos: ['fechamento'] };
  if (!Array.isArray(dias) || dias.length === 0) return { erro: 'Escolha pelo menos um dia de funcionamento.', campos: ['dias'] };
  if (dias.length > 7 || !dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return { erro: 'Dias inválidos (0 = domingo a 6 = sábado).', campos: ['dias'] };
  return { dados: { abertura, fechamento, dias: [...new Set(dias)].sort((a, b) => a - b) } };
}

/**
 * Endereco publico (slug): 3 a 40 caracteres, so letras minusculas sem acento,
 * numeros e hifen, fora da lista de reservados. Recusa em vez de trocar calado.
 */
function validarSlug(valor) {
  if (typeof valor !== 'string') return { erro: 'Endereço inválido.', campos: ['slugPublico'] };
  const slug = valor.trim().toLowerCase();
  if (slug.length < 3 || slug.length > 40) return { erro: 'O endereço precisa ter de 3 a 40 caracteres.', campos: ['slugPublico'] };
  if (!SLUG_RE.test(slug)) return { erro: 'Use só letras sem acento, números e hífen (ex.: studio-bela).', campos: ['slugPublico'] };
  if (SLUGS_RESERVADOS.has(slug)) return { erro: 'Esse endereço é reservado pelo sistema. Escolha outro.', campos: ['slugPublico'] };
  return { valor: slug };
}

module.exports = {
  SENHA_MINIMA, SENHA_MAXIMA, NOME_MAXIMO, IMAGEM_MAXIMA, SLUGS_RESERVADOS,
  normalizarEmail, emailValido, validarNome, erroSenhaNova, validarImagem, validarHorario, validarSlug,
};

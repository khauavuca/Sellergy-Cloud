// =====================================================================
// CONVITE DA EQUIPE — regras puras (sem banco).
// =====================================================================
// O dono (ou um ADMINISTRADOR) convida; a pessoa recebe um link
// /convite/<token> pelo WhatsApp do negocio, cria a senha e ja entra.
// Token aleatorio de 32 bytes, vale 7 dias. Cancelar = apagar o convite;
// reenviar = token novo e mais 7 dias (o link antigo para de funcionar).
// =====================================================================

const crypto = require('crypto');
const { normalizarTelefone } = require('../importacao/normalizar');

const DIAS_VALIDADE = 7;
const DIA_MS = 24 * 60 * 60 * 1000;
const PERFIS = ['ADMINISTRADOR', 'VENDEDOR'];
const SENHA_MINIMA = 8; // mesma regra do cadastro (onboarding/cadastro.js)
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function gerarToken() {
  return crypto.randomBytes(32).toString('base64url'); // 43 caracteres
}

function tokenComFormatoValido(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

function calcularExpiracao(agora = new Date()) {
  return new Date(agora.getTime() + DIAS_VALIDADE * DIA_MS);
}

/** PENDENTE | ACEITO | EXPIRADO */
function situacaoConvite(convite, agora = new Date()) {
  if (!convite) return null;
  if (convite.aceitoEm) return 'ACEITO';
  if (new Date(convite.expiraEm).getTime() <= agora.getTime()) return 'EXPIRADO';
  return 'PENDENTE';
}

/**
 * Valida o corpo do convite. `perfilSolicitante` aplica a regra de hierarquia:
 * ADMINISTRADOR nao convida outro ADMINISTRADOR (so o dono).
 * Retorna { erro, campos, status? } ou { dados }.
 */
function validarConvite(corpo = {}, { perfilSolicitante } = {}) {
  const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : '';
  const email = typeof corpo.email === 'string' ? corpo.email.trim().toLowerCase() : '';
  const perfil = String(corpo.perfil || 'VENDEDOR').toUpperCase();
  const especialistaId = typeof corpo.especialistaId === 'string' && corpo.especialistaId.trim() ? corpo.especialistaId.trim() : null;
  const campos = [];

  if (nome.length < 2 || nome.length > 80) campos.push('nome');
  if (!EMAIL_RE.test(email) || email.length > 120) campos.push('email');
  let telefone = null;
  if (typeof corpo.telefone === 'string' && corpo.telefone.trim()) {
    const t = normalizarTelefone(corpo.telefone);
    if (t.valor) telefone = t.valor;
    else campos.push('telefone');
  } else {
    campos.push('telefone'); // o convite vai pelo WhatsApp: celular e obrigatorio
  }
  if (!PERFIS.includes(perfil)) campos.push('perfil');
  if (campos.length) return { erro: 'Confira os campos destacados.', campos };

  if (perfilSolicitante !== 'CLIENT' && perfilSolicitante !== 'ADMINISTRADOR') {
    return { erro: 'Só a dona da conta ou um administrador convida pessoas.', campos: [], status: 403 };
  }
  if (perfilSolicitante === 'ADMINISTRADOR' && perfil === 'ADMINISTRADOR') {
    return { erro: 'Só a dona da conta pode convidar outro administrador.', campos: ['perfil'], status: 403 };
  }
  if (especialistaId && perfil !== 'VENDEDOR') {
    return { erro: 'Profissional da agenda entra como equipe (não como administrador).', campos: ['perfil'] };
  }
  return { dados: { nome, email, telefone, perfil, especialistaId } };
}

function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < SENHA_MINIMA || senha.length > 128) {
    return `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`;
  }
  return null;
}

/** Quantos lugares o convite ocupa no limite de usuarios: usuarios + convites pendentes. */
function usoComConvites(qtdUsuarios, convitesPendentes) {
  return qtdUsuarios + convitesPendentes;
}

function linkConvite(token, base = process.env.APP_URL_PUBLICA || process.env.VITE_URL_PUBLICA || 'http://localhost:5173') {
  return `${String(base).replace(/\/$/, '')}/convite/${token}`;
}

function textoConvite({ nomeConvidado, nomeQuemConvidou, nomeNegocio, link }) {
  const primeiro = String(nomeConvidado || '').split(' ')[0] || nomeConvidado;
  return `Oi, ${primeiro}! ${nomeQuemConvidou} te convidou pra equipe da ${nomeNegocio} no Sellergy.\n\n`
    + `Toque no link pra criar sua senha e entrar:\n${link}\n\nO convite vale por ${DIAS_VALIDADE} dias.`;
}

module.exports = {
  DIAS_VALIDADE,
  PERFIS,
  SENHA_MINIMA,
  gerarToken,
  tokenComFormatoValido,
  calcularExpiracao,
  situacaoConvite,
  validarConvite,
  validarSenha,
  usoComConvites,
  linkConvite,
  textoConvite,
};

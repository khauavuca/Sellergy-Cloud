// =====================================================================
// TOTP (RFC 6238) — codigo de 6 digitos do app autenticador (Google
// Authenticator, 1Password, Authy...). Sem dependencia externa: so crypto.
// =====================================================================
// O segredo fica cifrado no banco com o cofre (salt proprio, chave derivada
// pelo id do usuario). Um codigo ja usado nao vale de novo (anti-replay).
// =====================================================================

const crypto = require('crypto');
const { cifrar, decifrar } = require('../cripto/cofre');

const SALT = 'sellergy-totp-v1';
const PASSO_S = 30;
const DIGITOS = 6;
const JANELA = 1; // aceita 1 passo antes/depois (relogio do celular adiantado)
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(buf) {
  let bits = 0; let valor = 0; let saida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte; bits += 8;
    while (bits >= 5) { saida += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

function deBase32(texto) {
  const limpo = String(texto).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0; let valor = 0; const bytes = [];
  for (const c of limpo) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error('base32 invalido');
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { bytes.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

function gerarSegredo() {
  return base32(crypto.randomBytes(20));
}

function codigoNoPasso(segredoBase32, passo) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const hmac = crypto.createHmac('sha1', deBase32(segredoBase32)).update(contador).digest();
  const deslocamento = hmac[hmac.length - 1] & 0xf;
  const numero = (hmac.readUInt32BE(deslocamento) & 0x7fffffff) % 10 ** DIGITOS;
  return String(numero).padStart(DIGITOS, '0');
}

function passoAtual(agoraMs = Date.now()) {
  return Math.floor(agoraMs / 1000 / PASSO_S);
}

/**
 * Confere o codigo. Devolve o passo que bateu (pra anti-replay) ou null.
 * @param {string} segredoBase32
 * @param {string} codigo
 * @param {{ agoraMs?: number, ultimoPassoUsado?: number|null }} [op]
 */
function verificarCodigo(segredoBase32, codigo, { agoraMs = Date.now(), ultimoPassoUsado = null } = {}) {
  const c = String(codigo || '').replace(/\D/g, '');
  if (c.length !== DIGITOS) return null;
  const atual = passoAtual(agoraMs);
  for (let d = -JANELA; d <= JANELA; d += 1) {
    const passo = atual + d;
    if (ultimoPassoUsado !== null && passo <= ultimoPassoUsado) continue;
    const esperado = codigoNoPasso(segredoBase32, passo);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(c))) return passo;
  }
  return null;
}

function urlOtpauth({ segredo, conta, emissor = 'Sellergy Admin' }) {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  return `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=${DIGITOS}&period=${PASSO_S}`;
}

function cifrarSegredo(usuarioId, segredo) {
  const r = cifrar({ salt: SALT, clienteId: usuarioId, texto: segredo });
  return JSON.stringify({ c: r.conteudoCifrado.toString('base64'), i: r.iv.toString('base64'), t: r.tag.toString('base64'), v: r.versaoChave });
}

function decifrarSegredo(usuarioId, guardado) {
  const o = JSON.parse(guardado);
  return decifrar({
    salt: SALT, clienteId: usuarioId,
    registro: { conteudoCifrado: Buffer.from(o.c, 'base64'), iv: Buffer.from(o.i, 'base64'), tag: Buffer.from(o.t, 'base64'), versaoChave: o.v },
  });
}

module.exports = { gerarSegredo, verificarCodigo, codigoNoPasso, passoAtual, urlOtpauth, cifrarSegredo, decifrarSegredo, base32, deBase32 };

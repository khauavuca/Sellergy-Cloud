const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.MENSAGENS_MASTER_KEY = process.env.MENSAGENS_MASTER_KEY || crypto.randomBytes(32).toString('base64');
const totp = require('./totp');

// Vetor da RFC 6238 (SHA1, segredo "12345678901234567890").
const SEGREDO_RFC = totp.base32(Buffer.from('12345678901234567890'));

test('codigos batem com os vetores da RFC 6238 (6 digitos)', () => {
  assert.strictEqual(totp.codigoNoPasso(SEGREDO_RFC, Math.floor(59 / 30)), '287082');
  assert.strictEqual(totp.codigoNoPasso(SEGREDO_RFC, Math.floor(1111111109 / 30)), '081804');
  assert.strictEqual(totp.codigoNoPasso(SEGREDO_RFC, Math.floor(1234567890 / 30)), '005924');
});

test('aceita 1 passo de folga e recusa o resto', () => {
  const agoraMs = 1_700_000_000_000;
  const passo = totp.passoAtual(agoraMs);
  assert.strictEqual(totp.verificarCodigo(SEGREDO_RFC, totp.codigoNoPasso(SEGREDO_RFC, passo), { agoraMs }), passo);
  assert.strictEqual(totp.verificarCodigo(SEGREDO_RFC, totp.codigoNoPasso(SEGREDO_RFC, passo - 1), { agoraMs }), passo - 1);
  assert.strictEqual(totp.verificarCodigo(SEGREDO_RFC, totp.codigoNoPasso(SEGREDO_RFC, passo - 3), { agoraMs }), null);
  assert.strictEqual(totp.verificarCodigo(SEGREDO_RFC, 'abc', { agoraMs }), null);
});

test('anti-replay: codigo de passo ja usado nao entra de novo', () => {
  const agoraMs = 1_700_000_000_000;
  const passo = totp.passoAtual(agoraMs);
  const codigo = totp.codigoNoPasso(SEGREDO_RFC, passo);
  assert.strictEqual(totp.verificarCodigo(SEGREDO_RFC, codigo, { agoraMs, ultimoPassoUsado: passo }), null);
});

test('segredo cifrado volta igual e e diferente por usuario', () => {
  const s = totp.gerarSegredo();
  const a = totp.cifrarSegredo('usuario-a', s);
  assert.notStrictEqual(a, s);
  assert.strictEqual(totp.decifrarSegredo('usuario-a', a), s);
  assert.throws(() => totp.decifrarSegredo('usuario-b', a));
});

test('url otpauth tem emissor e segredo', () => {
  const u = totp.urlOtpauth({ segredo: 'ABC', conta: 'dono@x.com' });
  assert.match(u, /^otpauth:\/\/totp\/Sellergy%20Admin%3Adono%40x\.com\?secret=ABC&issuer=Sellergy%20Admin/);
});

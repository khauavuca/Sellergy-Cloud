const test = require('node:test');
const assert = require('node:assert');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste-com-tamanho-suficiente-123456';
const { ehTokenDeSessao } = require('./auth.middleware');

test('desafio do 2FA nao vale como sessao', () => {
  assert.strictEqual(ehTokenDeSessao({ id: 'u1', etapa: '2fa' }), false);
  assert.strictEqual(ehTokenDeSessao({ id: 'u1', perfil: 'CLIENT', etapa: '2fa' }), false);
  assert.strictEqual(ehTokenDeSessao({ id: 'u1' }), false);
  assert.strictEqual(ehTokenDeSessao(null), false);
  assert.strictEqual(ehTokenDeSessao({ id: 'u1', perfil: 'CLIENT', clienteId: 'c1' }), true);
  assert.strictEqual(ehTokenDeSessao({ id: 'a1', perfil: 'ADMIN', mfa: true }), true);
});

const test = require('node:test');
const assert = require('node:assert');
const { salaPermitida } = require('./tempoReal');

const ATIVO = { status: 'ACTIVE', modulosLiberados: { CRM: true } };
const usuarioDoBanco = (extra = {}) => ({ id: 'u1', perfil: 'CLIENT', clienteId: 'neg-1', versaoSessao: 0, permissoes: {}, ...extra });

test('sala vem do negócio do usuário no banco, nunca do que o navegador mandar', async () => {
  const sala = await salaPermitida(
    { id: 'u1', perfil: 'CLIENT', clienteId: 'neg-1', sv: 0 },
    { carregarUsuario: async () => usuarioDoBanco(), carregarCliente: async () => ATIVO },
  );
  assert.equal(sala, 'conversas:neg-1');
});

test('token de outro negócio (usuário mudou de conta) não entra', async () => {
  const sala = await salaPermitida(
    { id: 'u1', perfil: 'CLIENT', clienteId: 'neg-OUTRO', sv: 0 },
    { carregarUsuario: async () => usuarioDoBanco(), carregarCliente: async () => ATIVO },
  );
  assert.equal(sala, null);
});

test('vendedor sem permissão de CRM, sessão de suporte e usuário apagado não entram', async () => {
  const semPermissao = await salaPermitida(
    { id: 'u1', perfil: 'VENDEDOR', clienteId: 'neg-1', sv: 0 },
    { carregarUsuario: async () => usuarioDoBanco({ perfil: 'VENDEDOR' }), carregarCliente: async () => ATIVO },
  );
  assert.equal(semPermissao, null);
  assert.equal(await salaPermitida({ id: 'u1', suporte: true }), null);
  assert.equal(await salaPermitida(
    { id: 'u1', perfil: 'CLIENT', clienteId: 'neg-1', sv: 0 },
    { carregarUsuario: async () => null, carregarCliente: async () => ATIVO },
  ), null);
});

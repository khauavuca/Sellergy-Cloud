const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const s = require('./sessaoUsuario');

test('conferirSessao: excluido, versao antiga e negocio trocado caem', () => {
  const u = { id: 'u1', perfil: 'VENDEDOR', clienteId: 'c1', versaoSessao: 2 };
  assert.deepEqual(s.conferirSessao({ id: 'u1', clienteId: 'c1', sv: 2 }, u), { ok: true });
  assert.equal(s.conferirSessao({ id: 'u1', clienteId: 'c1', sv: 2 }, null).motivo, 'INEXISTENTE');
  assert.equal(s.conferirSessao({ id: 'u1', clienteId: 'c1', sv: 1 }, u).motivo, 'VERSAO');
  assert.equal(s.conferirSessao({ id: 'u1', clienteId: 'c1' }, u).motivo, 'VERSAO');
  assert.equal(s.conferirSessao({ id: 'u1', clienteId: 'c1' }, { ...u, versaoSessao: 0 }).ok, true);
  assert.equal(s.conferirSessao({ id: 'u1', clienteId: 'c2', sv: 2 }, u).motivo, 'CLIENTE');
});

test('com senha provisoria so libera perfil, trocar senha e sair', () => {
  assert.equal(s.rotaLiberadaSemTrocarSenha('GET', '/autenticacao/perfil'), true);
  assert.equal(s.rotaLiberadaSemTrocarSenha('POST', '/autenticacao/trocar-senha'), true);
  assert.equal(s.rotaLiberadaSemTrocarSenha('POST', '/autenticacao/logout'), true);
  assert.equal(s.rotaLiberadaSemTrocarSenha('GET', '/crm/leads'), false);
  assert.equal(s.rotaLiberadaSemTrocarSenha('POST', '/vendas'), false);
});

test('carregarUsuario usa cache de 30 s e invalidar limpa', async () => {
  let consultas = 0;
  s._definirPrisma({ usuario: { findUnique: async () => { consultas++; return { id: 'u9', perfil: 'CLIENT', versaoSessao: 0 }; } } });
  s.limparCache();
  await s.carregarUsuario('u9', { agora: 1000 });
  await s.carregarUsuario('u9', { agora: 1000 + 29000 });
  assert.equal(consultas, 1);
  await s.carregarUsuario('u9', { agora: 1000 + 31000 });
  assert.equal(consultas, 2);
  s.invalidar('u9');
  await s.carregarUsuario('u9', { agora: 1000 + 31000 });
  assert.equal(consultas, 3);
});

test('assinarToken leva a versao e o logout revoga o token', async () => {
  const token = s.assinarToken({ id: 'u1', perfil: 'CLIENT', clienteId: 'c1', versaoSessao: 3 }, 'segredo');
  const d = jwt.verify(token, 'segredo');
  assert.equal(d.sv, 3);
  assert.ok(d.jti);
  const guardado = new Map();
  s._definirRedis({ set: async (k, v) => { guardado.set(k, v); }, exists: async (k) => (guardado.has(k) ? 1 : 0) });
  assert.equal(await s.tokenRevogado(token), false);
  assert.equal(await s.revogarToken(token, 'segredo'), true);
  assert.equal(await s.tokenRevogado(token), true);
  assert.equal(await s.revogarToken('lixo', 'segredo'), false);
});

const test = require('node:test');
const assert = require('node:assert');
const { origensAdmin, origemLiberada, mensagemBloqueio } = require('./acessoAdmin');

test('origens do admin: lista limpa, sem barra final e em minúsculas', () => {
  assert.deepStrictEqual(origensAdmin(' https://CRM.sellergycloud.com/ , http://localhost:5173,,'), [
    'https://crm.sellergycloud.com',
    'http://localhost:5173',
  ]);
  assert.deepStrictEqual(origensAdmin(''), []);
  assert.deepStrictEqual(origensAdmin(undefined), []);
});

test('sem ADMIN_ORIGENS o admin entra de qualquer lugar (dev)', () => {
  assert.strictEqual(origemLiberada('https://sellergycloud.com', []), true);
  assert.strictEqual(origemLiberada(undefined, []), true);
});

test('com ADMIN_ORIGENS o admin só entra pelo site do painel', () => {
  const lista = origensAdmin('https://crm.sellergycloud.com');
  assert.strictEqual(origemLiberada('https://crm.sellergycloud.com', lista), true);
  assert.strictEqual(origemLiberada('https://crm.sellergycloud.com/', lista), true);
  assert.strictEqual(origemLiberada('https://sellergycloud.com', lista), false);
  assert.strictEqual(origemLiberada('https://crm.sellergycloud.com.golpe.com', lista), false);
  assert.strictEqual(origemLiberada(undefined, lista), false, 'sem Origin (curl) não passa');
});

test('mensagem do bloqueio arredonda os minutos pra cima', () => {
  assert.match(mensagemBloqueio(1799), /30 min/);
  assert.match(mensagemBloqueio(5), /1 min/);
});

test('camadas separadas: cliente nao entra pelo painel, admin nao entra pelo site', () => {
  const { camadaRecusada } = require('./acessoAdmin');
  const lista = ['https://crm.sellergycloud.com'];
  const crm = 'https://crm.sellergycloud.com';
  const site = 'https://sellergycloud.com';
  assert.equal(camadaRecusada({ origem: crm, perfil: 'CLIENTE' }, lista), true);
  assert.equal(camadaRecusada({ origem: site, perfil: 'CLIENTE' }, lista), false);
  assert.equal(camadaRecusada({ origem: site, perfil: 'ADMIN' }, lista), true);
  assert.equal(camadaRecusada({ origem: crm, perfil: 'ADMIN' }, lista), false);
  assert.equal(camadaRecusada({ origem: crm, perfil: 'CLIENTE', suporte: { id: 1 } }, lista), false);
  assert.equal(camadaRecusada({ origem: undefined, perfil: 'CLIENTE' }, lista), false);
  assert.equal(camadaRecusada({ origem: crm, perfil: 'CLIENTE' }, []), false);
  assert.equal(camadaRecusada({ origem: 'http://localhost:5173', perfil: 'CLIENTE' }, [...lista, 'http://localhost:5173']), false);
});

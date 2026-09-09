const test = require('node:test');
const assert = require('node:assert');
const { normalizarTelefone, candidatosDeBusca } = require('./telefone');

test('normalizarTelefone tira mascara e mantem DDD + numero', () => {
  assert.strictEqual(normalizarTelefone('(11) 99999-8888'), '11999998888');
  assert.strictEqual(normalizarTelefone('11 9999-8888'), '1199998888');
  assert.strictEqual(normalizarTelefone('11999998888'), '11999998888');
});

test('normalizarTelefone remove o DDI 55 so quando o numero vem completo', () => {
  assert.strictEqual(normalizarTelefone('5511999998888'), '11999998888'); // 13 digitos
  assert.strictEqual(normalizarTelefone('551199998888'), '1199998888'); // 12 digitos
  // 10-11 digitos comecando com 55 e DDD 55 (Rio Grande do Sul), nao DDI.
  assert.strictEqual(normalizarTelefone('55999998888'), '55999998888');
});

test('normalizarTelefone devolve null pra vazio/invalido', () => {
  assert.strictEqual(normalizarTelefone(''), null);
  assert.strictEqual(normalizarTelefone(null), null);
  assert.strictEqual(normalizarTelefone(undefined), null);
  assert.strictEqual(normalizarTelefone('abc'), null);
});

test('candidatosDeBusca cobre canonico + sufixos de 9 e 8 digitos', () => {
  assert.deepStrictEqual(candidatosDeBusca('5511999998888'), ['11999998888', '999998888', '99998888']);
  assert.deepStrictEqual(candidatosDeBusca('551199998888'), ['1199998888', '199998888', '99998888']);
});

test('candidatosDeBusca nao gera candidato com menos de 8 digitos', () => {
  assert.deepStrictEqual(candidatosDeBusca('1234567'), []);
  assert.deepStrictEqual(candidatosDeBusca('99998888'), ['99998888']);
  assert.deepStrictEqual(candidatosDeBusca(''), []);
});

test('o remetente casa com o lead gravado em qualquer formato usual', () => {
  const remetente = '5511999998888';
  const candidatos = new Set(candidatosDeBusca(remetente));
  for (const gravado of ['(11) 99999-8888', '11999998888', '5511999998888', '999998888', '99998888']) {
    assert.ok(candidatos.has(normalizarTelefone(gravado)), `nao casou: ${gravado}`);
  }
});

const test = require('node:test');
const assert = require('node:assert');
const { paraNumero, lerDinheiro, lerInteiro } = require('./numero');

test('paraNumero aceita virgula, milhar e numero', () => {
  assert.strictEqual(paraNumero('10,50'), 10.5);
  assert.strictEqual(paraNumero('1.234,56'), 1234.56);
  assert.strictEqual(paraNumero('R$ 7,99'), 7.99);
  assert.strictEqual(paraNumero('25.90'), 25.9);
  assert.strictEqual(paraNumero(3), 3);
  assert.strictEqual(paraNumero('-5'), -5);
});

test('paraNumero recusa lixo', () => {
  for (const v of ['abc', '', '  ', '1,2,3', 'Infinity', null, undefined, [], {}, Infinity, NaN, '1e12', '10,5x']) {
    assert.ok(Number.isNaN(paraNumero(v)), `deveria ser NaN: ${String(v)}`);
  }
});

test('lerDinheiro arredonda em centavos e respeita limites', () => {
  assert.deepStrictEqual(lerDinheiro('10,505'), { ok: true, valor: 10.51 });
  assert.strictEqual(lerDinheiro('-1').ok, false);
  assert.strictEqual(lerDinheiro('99999999').ok, false);
  assert.strictEqual(lerDinheiro('-1', { min: -100 }).ok, true);
});

test('lerInteiro recusa fracao', () => {
  assert.deepStrictEqual(lerInteiro('3'), { ok: true, valor: 3 });
  assert.strictEqual(lerInteiro('2,5').ok, false);
  assert.strictEqual(lerInteiro(0).ok, false);
  assert.strictEqual(lerInteiro(0, { min: 0 }).ok, true);
});

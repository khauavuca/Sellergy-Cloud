const test = require('node:test');
const assert = require('node:assert');
const r = require('./regras');

test('intervalo do dia: meia-noite a meia-noite', () => {
  const { inicio, fim } = r.intervaloDoDia(new Date(2026, 10, 24, 15, 42));
  assert.deepStrictEqual([inicio.getDate(), inicio.getHours(), inicio.getMinutes()], [24, 0, 0]);
  assert.strictEqual(fim.getTime() - inicio.getTime(), 24 * 60 * 60 * 1000);
});

test('valor do teclado em centavos', () => {
  assert.deepStrictEqual(r.valorDosCentavos(18000), { valor: 180 });
  assert.deepStrictEqual(r.valorDosCentavos('1990'), { valor: 19.9 });
  assert.ok(r.valorDosCentavos(0).erro);
  assert.ok(r.valorDosCentavos(50).erro); // R$ 0,50
  assert.ok(r.valorDosCentavos(1.5).erro);
  assert.ok(r.valorDosCentavos('12a').erro);
  assert.ok(r.valorDosCentavos(5000001).erro);
});

test('arredonda a 2 casas', () => {
  assert.strictEqual(r.arred(0.1 + 0.2), 0.3);
  assert.strictEqual(r.arred(null), 0);
});

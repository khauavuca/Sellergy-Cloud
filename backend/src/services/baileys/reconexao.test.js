const test = require('node:test');
const assert = require('node:assert');
const {
  calcularAtrasoReconexao, deveDesistir, atrasoNoBoot,
  BASE_MS, TETO_MS, MAX_TENTATIVAS, BOOT_LOTE, BOOT_INTERVALO_MS,
} = require('./reconexao');

test('atraso dobra a cada tentativa a partir da base', () => {
  assert.strictEqual(calcularAtrasoReconexao(1, 0), BASE_MS);
  assert.strictEqual(calcularAtrasoReconexao(2, 0), BASE_MS * 2);
  assert.strictEqual(calcularAtrasoReconexao(3, 0), BASE_MS * 4);
  assert.strictEqual(calcularAtrasoReconexao(4, 0), BASE_MS * 8);
});

test('atraso nunca passa do teto', () => {
  assert.strictEqual(calcularAtrasoReconexao(20, 0), TETO_MS);
  assert.strictEqual(calcularAtrasoReconexao(100, 0), TETO_MS);
});

test('jitter soma ate 1s e nunca reduz o atraso', () => {
  const semJitter = calcularAtrasoReconexao(2, 0);
  const comJitter = calcularAtrasoReconexao(2, 0.999);
  assert.ok(comJitter > semJitter);
  assert.ok(comJitter - semJitter < 1_000);
});

test('tentativa 0 ou negativa e tratada como a primeira', () => {
  assert.strictEqual(calcularAtrasoReconexao(0, 0), BASE_MS);
  assert.strictEqual(calcularAtrasoReconexao(-3, 0), BASE_MS);
});

test('desiste so depois de MAX_TENTATIVAS', () => {
  assert.strictEqual(deveDesistir(MAX_TENTATIVAS), false);
  assert.strictEqual(deveDesistir(MAX_TENTATIVAS + 1), true);
});

test('boot religa em lotes com intervalo entre eles', () => {
  for (let i = 0; i < BOOT_LOTE; i++) assert.strictEqual(atrasoNoBoot(i), 0);
  assert.strictEqual(atrasoNoBoot(BOOT_LOTE), BOOT_INTERVALO_MS);
  assert.strictEqual(atrasoNoBoot(BOOT_LOTE * 2), BOOT_INTERVALO_MS * 2);
  // 100 bots: o ultimo espera ~50s, nao 0.
  assert.strictEqual(atrasoNoBoot(99), Math.floor(99 / BOOT_LOTE) * BOOT_INTERVALO_MS);
});

const test = require('node:test');
const assert = require('node:assert');
const { qrAbandonado } = require('./gerenciadorConexao');

test('QR abandonado: so depois do limite e so se houve QR', () => {
  assert.equal(qrAbandonado({ desde: undefined, agora: 10_000_000, limiteMs: 1000 }), false); // ja pareado / sem QR
  assert.equal(qrAbandonado({ desde: 1000, agora: 1500, limiteMs: 1000 }), false);
  assert.equal(qrAbandonado({ desde: 1000, agora: 2000, limiteMs: 1000 }), true);
});

test('limite padrao de 5 min e configuravel por BAILEYS_QR_EXPIRA_MS', () => {
  delete process.env.BAILEYS_QR_EXPIRA_MS;
  assert.equal(qrAbandonado({ desde: 1, agora: 4 * 60_000 }), false);
  assert.equal(qrAbandonado({ desde: 1, agora: 5 * 60_000 + 1 }), true);
  process.env.BAILEYS_QR_EXPIRA_MS = '60000';
  assert.equal(qrAbandonado({ desde: 1, agora: 60_001 }), true);
  delete process.env.BAILEYS_QR_EXPIRA_MS;
});

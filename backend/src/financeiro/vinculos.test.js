const test = require('node:test');
const assert = require('node:assert');
const { limparVinculos, lerChaveRepeticao } = require('../controllers/FinanceiroController');

test('listagem esconde lead e venda de outro negocio', () => {
  const l = limparVinculos({
    id: 'l1', clienteId: 'A', leadId: 'x', vendaId: 'v',
    lead: { nome: 'Fulano', telefone: '11', clienteId: 'B' },
    venda: { id: 'v', clienteId: 'B', valor: 10 },
  });
  assert.strictEqual(l.lead, null);
  assert.strictEqual(l.leadId, null);
  assert.strictEqual(l.venda, null);
  assert.strictEqual(l.vendaId, null);
});

test('listagem mantem lead do proprio negocio sem expor clienteId', () => {
  const l = limparVinculos({ id: 'l1', clienteId: 'A', leadId: 'x', lead: { nome: 'Ana', clienteId: 'A' }, venda: null });
  assert.deepStrictEqual(l.lead, { nome: 'Ana' });
  assert.strictEqual(l.leadId, 'x');
});

test('chave de repeticao: aceita do cabecalho ou do corpo, recusa formato estranho', () => {
  const req = (h, b) => ({ get: (k) => (k === 'Idempotency-Key' ? h : undefined), body: b || {} });
  assert.strictEqual(lerChaveRepeticao(req('abc12345-xyz')), 'abc12345-xyz');
  assert.strictEqual(lerChaveRepeticao(req(undefined, { chaveRepeticao: 'k_12345678' })), 'k_12345678');
  assert.strictEqual(lerChaveRepeticao(req('curta')), null);
  assert.strictEqual(lerChaveRepeticao(req('tem espaco aqui')), null);
});

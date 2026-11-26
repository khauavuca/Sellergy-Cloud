const test = require('node:test');
const assert = require('node:assert');
const { corpoDeErro, MENSAGEM_500 } = require('./respostaSegura');

test('erro 4xx com "error" ganha "erro" igual (e vice-versa)', () => {
  assert.deepStrictEqual(corpoDeErro(422, { error: 'Nome obrigatório' }), { erro: 'Nome obrigatório', error: 'Nome obrigatório' });
  assert.deepStrictEqual(corpoDeErro(400, { erro: 'X', campos: ['a'] }), { erro: 'X', error: 'X', campos: ['a'] });
});

test('erro 5xx nunca devolve texto interno', () => {
  const r = corpoDeErro(500, { error: 'Invalid `tx.lead.create()` invocation in /app/src/routes/crm.routes.js:279' });
  assert.strictEqual(r.erro, MENSAGEM_500);
  assert.ok(!JSON.stringify(r).includes('crm.routes'));
});

test('5xx mantém só o código conhecido', () => {
  assert.deepStrictEqual(corpoDeErro(503, { erro: 'x', codigo: 'SEM_CANAL', detalhe: 'segredo' }), { erro: MENSAGEM_500, error: MENSAGEM_500, codigo: 'SEM_CANAL' });
});

test('respostas de sucesso e listas passam intactas', () => {
  const lista = [{ id: 1 }];
  assert.strictEqual(corpoDeErro(200, lista), lista);
  assert.deepStrictEqual(corpoDeErro(201, { ok: true }), { ok: true });
  assert.deepStrictEqual(corpoDeErro(404, { ok: false }), { ok: false });
});

const test = require('node:test');
const assert = require('node:assert');

process.env.ASAAS_PLATAFORMA_WEBHOOK_TOKEN = 'token-de-teste-com-tamanho-bom';
const { valorDoCiclo, diasEntre, REGUA, somarMeses } = require('./cobranca');
const { tokenConfere, idDoEvento } = require('./webhookAsaas');

test('valor do ciclo: mensal pelo plano, anual com 20% e mensalidade negociada', () => {
  assert.strictEqual(valorDoCiclo('BASIC', 'MENSAL'), 59);
  assert.strictEqual(valorDoCiclo('PRO', 'ANUAL'), 1142.4); // 119 * 12 * 0,8
  assert.strictEqual(valorDoCiclo('PRO', 'MENSAL', 99), 99);
});

test('somarMeses nao pula mes no dia 31', () => {
  const d = somarMeses(new Date(2026, 0, 31), 1);
  assert.strictEqual(d.getMonth(), 1);
  assert.strictEqual(d.getDate(), 28);
});

test('diasEntre conta dias de calendario em Brasilia', () => {
  const venc = new Date('2026-11-27T15:00:00Z');
  assert.strictEqual(diasEntre(new Date('2026-11-24T12:00:00Z'), venc), -3);
  assert.strictEqual(diasEntre(new Date('2026-11-27T02:00:00Z'), venc), -1); // ainda 26/11 em SP
  assert.strictEqual(diasEntre(new Date('2026-11-30T20:00:00Z'), venc), 3);
});

test('regua cobre antes, no dia e depois do vencimento', () => {
  assert.deepStrictEqual(REGUA, [-3, 0, 1, 3, 7]);
});

test('token do webhook: confere em tempo constante e recusa diferente/vazio', () => {
  assert.ok(tokenConfere('token-de-teste-com-tamanho-bom'));
  assert.ok(!tokenConfere('token-de-teste-com-tamanho-ruim'));
  assert.ok(!tokenConfere(''));
  assert.ok(!tokenConfere(undefined));
});

test('id do evento usa o id do Asaas ou monta um estavel', () => {
  assert.strictEqual(idDoEvento({ id: 'evt_1', event: 'PAYMENT_RECEIVED' }), 'evt_1');
  const a = idDoEvento({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED' } });
  const b = idDoEvento({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED' } });
  assert.strictEqual(a, b);
});

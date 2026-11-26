const test = require('node:test');
const assert = require('node:assert');
const envio = require('./envioHumano');

test('variarTexto escolhe uma opcao de cada grupo e mantem o resto', () => {
  for (let i = 0; i < 30; i += 1) {
    const t = envio.variarTexto('{Oi|Olá|E aí}, Ana! {Tudo bem|Como vai}?');
    assert.match(t, /^(Oi|Olá|E aí), Ana! (Tudo bem|Como vai)\?$/);
  }
  assert.strictEqual(envio.variarTexto('sem chaves'), 'sem chaves');
  assert.strictEqual(envio.variarTexto('{so um}'), '{so um}');
});

test('variarTexto resolve grupos aninhados', () => {
  const t = envio.variarTexto('{a|{b|c}}');
  assert.ok(['a', 'b', 'c'].includes(t));
});

test('cota de campanha cresce com a idade do numero', () => {
  assert.strictEqual(envio.cotaPorIdade(0), 30);
  assert.strictEqual(envio.cotaPorIdade(5), 80);
  assert.strictEqual(envio.cotaPorIdade(10), 180);
  assert.strictEqual(envio.cotaPorIdade(20), 300);
  assert.strictEqual(envio.cotaPorIdade(400), 450);
});

test('dataSP usa o fuso de Brasilia', () => {
  // 02:30 UTC = 23:30 do dia anterior em Brasilia
  const r = envio.dataSP(new Date('2026-11-24T02:30:00Z'));
  assert.strictEqual(r.dia, '20261123');
  assert.strictEqual(r.hora, 23);
});

test('pedido de saida reconhece SAIR/PARAR e ignora conversa', () => {
  assert.ok(envio.ehPedidoDeSaida('SAIR'));
  assert.ok(envio.ehPedidoDeSaida(' parar. '));
  assert.ok(!envio.ehPedidoDeSaida('quero sair mais cedo amanhã'));
  assert.ok(!envio.ehPedidoDeSaida('cancelar')); // "cancelar" e resposta de lembrete, nao opt-out
});

test('espacamento de campanha e bem maior que o de conversa', () => {
  assert.ok(envio.ESPACO.campanha[0] > envio.ESPACO.lembrete[1]);
  assert.ok(envio.ESPACO.lembrete[0] > envio.ESPACO.conversa[0]);
});

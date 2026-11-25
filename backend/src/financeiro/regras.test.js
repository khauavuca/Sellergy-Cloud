const test = require('node:test');
const assert = require('node:assert');
const r = require('./regras');

test('lerDataDia: YYYY-MM-DD vira meio-dia UTC e cai no mesmo dia em Brasilia', () => {
  const x = r.lerDataDia('2026-11-30');
  assert.ok(x.ok);
  assert.strictEqual(x.data.toISOString(), '2026-11-30T12:00:00.000Z');
  assert.strictEqual(r.diaBRT(x.data), '2026-11-30');
});

test('lerDataDia recusa 31/02, ano fora de 1900..2100 e texto', () => {
  assert.strictEqual(r.lerDataDia('2026-02-31').ok, false);
  assert.strictEqual(r.lerDataDia('1899-12-31').ok, false);
  assert.strictEqual(r.lerDataDia('3000-01-01').ok, false);
  assert.strictEqual(r.lerDataDia('amanha').ok, false);
  assert.strictEqual(r.lerDataDia(12345).ok, false);
  assert.strictEqual(r.lerDataDia('2026-13-01T10:00:00Z').ok, false);
  assert.ok(r.lerDataDia('2026-11-25T12:00:00Z').ok);
});

test('lerPeriodo: dias de Brasilia, inicio depois do fim e datas invalidas', () => {
  const p = r.lerPeriodo({ inicio: '2026-11-01', fim: '2026-11-30' });
  assert.ok(p.ok);
  assert.strictEqual(p.inicio.toISOString(), '2026-11-01T03:00:00.000Z');
  assert.strictEqual(p.fim.toISOString(), '2026-12-01T02:59:59.999Z');
  assert.strictEqual(r.lerPeriodo({ inicio: '2026-12-01', fim: '2026-11-01' }).ok, false);
  assert.strictEqual(r.lerPeriodo({ inicio: 'xx' }).ok, false);
  assert.strictEqual(r.lerPeriodo({ fim: '2026-02-30' }).ok, false);
  const padrao = r.lerPeriodo({}, { padraoDias: 30, agora: new Date('2026-11-25T15:00:00Z') });
  assert.strictEqual(padrao.inicio.toISOString(), '2026-10-27T03:00:00.000Z');
  assert.strictEqual(padrao.fim.toISOString(), '2026-11-26T02:59:59.999Z');
});

test('somarDias soma numero (nao texto)', () => {
  const d = r.somarDias(new Date('2026-11-30T12:00:00Z'), 5);
  assert.strictEqual(d.toISOString(), '2026-12-05T12:00:00.000Z');
});

test('validarAdiamento: so pendente, dias 1..365 inteiros, aceita "5"', () => {
  assert.deepStrictEqual(r.validarAdiamento('PENDENTE', '5'), { ok: true, dias: 5 });
  assert.strictEqual(r.validarAdiamento('PENDENTE', -3).ok, false);
  assert.strictEqual(r.validarAdiamento('PENDENTE', 0).ok, false);
  assert.strictEqual(r.validarAdiamento('PENDENTE', 2.5).ok, false);
  assert.strictEqual(r.validarAdiamento('PAGO', 3).ok, false);
  assert.strictEqual(r.validarAdiamento('CANCELADO', 3).ok, false);
});

test('parcelas: 1..60 inteiras e soma exata em centavos', () => {
  assert.strictEqual(r.lerParcelas(0).ok, false);
  assert.strictEqual(r.lerParcelas(-1).ok, false);
  assert.strictEqual(r.lerParcelas('abc').ok, false);
  assert.strictEqual(r.lerParcelas(1.5).ok, false);
  assert.strictEqual(r.lerParcelas(61).ok, false);
  assert.strictEqual(r.lerParcelas('3').valor, 3);
  const partes = r.dividirParcelas(100, 3);
  assert.deepStrictEqual(partes, [33.33, 33.33, 33.34]);
  assert.strictEqual(Math.round(partes.reduce((a, b) => a + b, 0) * 100), 10000);
});

test('vencimentoParcela mantem o dia e usa o ultimo dia do mes quando falta', () => {
  const base = new Date('2026-01-31T12:00:00Z');
  assert.strictEqual(r.vencimentoParcela(base, 1).toISOString(), '2026-02-28T12:00:00.000Z');
  assert.strictEqual(r.vencimentoParcela(base, 2).toISOString(), '2026-03-31T12:00:00.000Z');
  assert.strictEqual(r.vencimentoParcela(base, 12).toISOString(), '2027-01-31T12:00:00.000Z');
});

test('transicao de status: nada de ATRASADO manual, pagar cancelado ou cancelar pelo PATCH', () => {
  assert.strictEqual(r.validarTransicaoStatus('PENDENTE', 'ATRASADO').ok, false);
  assert.strictEqual(r.validarTransicaoStatus('CANCELADO', 'PAGO').ok, false);
  assert.strictEqual(r.validarTransicaoStatus('PENDENTE', 'CANCELADO').ok, false);
  assert.strictEqual(r.validarTransicaoStatus('PENDENTE', 'XYZ').ok, false);
  assert.strictEqual(r.validarTransicaoStatus(undefined, undefined).ok, false);
  assert.ok(r.validarTransicaoStatus('PENDENTE', 'PAGO').ok);
  assert.ok(r.validarTransicaoStatus('PAGO', 'PENDENTE').ok);
  assert.ok(r.validarTransicaoStatus('CANCELADO', 'PENDENTE').ok);
  assert.ok(r.validarTransicaoStatus('PAGO', 'PAGO').semMudanca);
});

test('cancelamento exige motivo e nao cancela pago', () => {
  assert.strictEqual(r.validarCancelamento('PENDENTE', '').ok, false);
  assert.strictEqual(r.validarCancelamento('PENDENTE', 'ab').ok, false);
  assert.strictEqual(r.validarCancelamento('PAGO', 'motivo ok').ok, false);
  assert.strictEqual(r.validarCancelamento('CANCELADO', 'motivo ok').ok, false);
  assert.deepStrictEqual(r.validarCancelamento('PENDENTE', '  cliente desistiu '), { ok: true, motivo: 'cliente desistiu' });
});

test('mes fechado compara ano-mes em Brasilia', () => {
  const agora = new Date('2026-11-01T12:00:00Z');
  assert.strictEqual(r.ehMesFechado({ status: 'PAGO', dataPagamento: new Date('2026-11-01T02:00:00Z') }, agora), true); // 23h de 31/10 em Brasilia: outubro
  assert.strictEqual(r.ehMesFechado({ status: 'PAGO', dataPagamento: new Date('2026-11-01T04:00:00Z') }, agora), false); // 01h de 01/11 em Brasilia
  assert.strictEqual(r.ehMesFechado({ status: 'PAGO', dataPagamento: new Date('2026-10-15T12:00:00Z') }, agora), true);
  assert.strictEqual(r.ehMesFechado({ status: 'PENDENTE', dataVencimento: new Date('2020-01-01') }, agora), false);
  assert.strictEqual(r.dataEmMesFechado(new Date('2026-10-20T12:00:00Z'), agora), true);
});

test('indice de eficacia nunca passa de 100', () => {
  assert.strictEqual(r.indiceEficacia(5, 2), 100);
  assert.strictEqual(r.indiceEficacia(1, 4), 25);
  assert.strictEqual(r.indiceEficacia(3, 0), 0);
});

test('conta a pagar: dia 32, mes 13 e periodicidade invalida sao recusados', () => {
  assert.strictEqual(r.validarAgendaConta({ diaVencimento: 32 }).ok, false);
  assert.strictEqual(r.validarAgendaConta({ mesVencimento: 13 }).ok, false);
  assert.strictEqual(r.validarAgendaConta({ periodicidade: 'SEMANAL' }).ok, false);
  const ok = r.validarAgendaConta({ periodicidade: 'ANUAL', diaVencimento: '10', mesVencimento: 3 });
  assert.deepStrictEqual(ok.valores, { periodicidade: 'ANUAL', diaVencimento: 10, mesVencimento: 3 });
  assert.deepStrictEqual(r.validarAgendaConta({}).valores, { periodicidade: 'MENSAL' });
  assert.deepStrictEqual(r.validarAgendaConta({ diaVencimento: 5 }, { parcial: true }).valores, { diaVencimento: 5 });
});

test('retirada maior que o saldo pede confirmacao', () => {
  const x = r.checarRetirada(99999, 150.75, false);
  assert.strictEqual(x.ok, false);
  assert.strictEqual(x.codigo, 'SALDO_INSUFICIENTE');
  assert.ok(r.checarRetirada(99999, 150.75, true).ok);
  assert.ok(r.checarRetirada(150.75, 150.75, false).ok);
});

test('fechamento com diferenca acima de R$ 10 exige observacao', () => {
  assert.strictEqual(r.checarFechamento(-10.01, '').ok, false);
  assert.strictEqual(r.checarFechamento(25, 'ok').ok, false);
  assert.ok(r.checarFechamento(25, 'troco errado').ok);
  assert.ok(r.checarFechamento(-10, null).ok);
});

test('repartirPorPeso soma exatamente o total vendido', () => {
  const p = r.repartirPorPeso(100, [1, 1, 1]);
  assert.strictEqual(Math.round(p.reduce((a, b) => a + b, 0) * 100), 10000);
  assert.deepStrictEqual(r.repartirPorPeso(90, [200, 100]), [60, 30]);
  assert.deepStrictEqual(r.repartirPorPeso(10, [0, 0]), [5, 5]);
  assert.deepStrictEqual(r.repartirPorPeso(10, []), []);
});

test('fechamento mensal so de mes encerrado e ano razoavel', () => {
  const agora = new Date('2026-11-25T12:00:00Z');
  assert.strictEqual(r.validarMesFechamento(2026, 11, agora).ok, false);
  assert.strictEqual(r.validarMesFechamento(2026, 12, agora).ok, false);
  assert.strictEqual(r.validarMesFechamento(3000, 1, agora).ok, false);
  assert.strictEqual(r.validarMesFechamento(1900, 1, agora).ok, false);
  assert.strictEqual(r.validarMesFechamento(2026, 13, agora).ok, false);
  assert.ok(r.validarMesFechamento(2026, 10, agora).ok);
});

test('proximaCompetencia vira o ano', () => {
  assert.strictEqual(r.proximaCompetencia('2026-12'), '2027-01');
  assert.strictEqual(r.proximaCompetencia('2026-03'), '2026-04');
});

test('lerTexto limita tamanho', () => {
  assert.strictEqual(r.lerTexto('a'.repeat(121), { max: 120 }).ok, false);
  assert.strictEqual(r.lerTexto('   ', { obrigatorio: true }).ok, false);
  assert.strictEqual(r.lerTexto('x', { min: 2 }).ok, false);
  assert.strictEqual(r.lerTexto(undefined).valor, null);
});

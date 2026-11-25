// Regras puras das correcoes da agenda/catalogo (testes de uso, 25/11).
const test = require('node:test');
const assert = require('node:assert');
const {
  mesmoTelefone, telefoneComDDD, lerDataHora, validarJornada, avisosDoHorario,
} = require('./utilAgenda');
const { lerCamposAgendamento } = require('./validacaoAgendamento');

test('telefone: outro DDD com os mesmos 8 finais NAO e a mesma pessoa', () => {
  assert.ok(!mesmoTelefone('(11) 98888-1234', '(21) 98888-1234'));
  assert.ok(!mesmoTelefone('11988881234', '3198881234'));
});

test('telefone: mesmo numero com +55, mascara ou sem o 9 casa', () => {
  assert.ok(mesmoTelefone('(11) 99999-0001', '5511999990001'));
  assert.ok(mesmoTelefone('11 9999-0001', '11999990001'));
  assert.ok(mesmoTelefone('+55 (21) 3333-4444', '2133334444'));
  assert.ok(!mesmoTelefone('', ''));
  assert.ok(!mesmoTelefone('99990001', '99990001'), 'sem DDD nao da pra garantir');
  assert.strictEqual(telefoneComDDD('011 99999-0001'), '11999990001');
});

test('data: recusa 31/02, texto, ano 1900- e 3000', () => {
  assert.ok(!lerDataHora('2026-02-31T10:00:00').ok);
  assert.ok(!lerDataHora('amanha').ok);
  assert.ok(!lerDataHora('3000-01-01T10:00:00Z').ok);
  assert.ok(!lerDataHora('1800-01-01T10:00:00Z').ok);
  assert.ok(!lerDataHora(undefined).ok);
  assert.ok(lerDataHora('2026-12-15T13:00:00.000Z').ok);
});

test('jornada: valida formato, horario e sobreposicao', () => {
  assert.ok(validarJornada(null).ok);
  assert.ok(!validarJornada([]).ok);
  assert.ok(!validarJornada('seg').ok);
  assert.ok(!validarJornada({ 8: [{ inicio: '08:00', fim: '12:00' }] }).ok);
  assert.ok(!validarJornada({ 1: [{ inicio: '25:00', fim: '26:00' }] }).ok);
  assert.ok(!validarJornada({ 1: [{ inicio: '12:00', fim: '08:00' }] }).ok);
  assert.ok(!validarJornada({ 1: [{ inicio: '08:00', fim: '12:00' }, { inicio: '11:00', fim: '14:00' }] }).ok);
  const ok = validarJornada({ 1: [{ inicio: '13:00', fim: '18:00' }, { inicio: '8:00', fim: '12:00' }] });
  assert.ok(ok.ok);
  assert.deepStrictEqual(ok.valor['1'][0], { inicio: '08:00', fim: '12:00' });
});

test('avisos: passado e fora do expediente', () => {
  const agora = new Date('2026-11-25T12:00:00-03:00'); // quarta
  const jornada = { 3: [{ inicio: '09:00', fim: '18:00' }] };
  assert.deepStrictEqual(avisosDoHorario({ inicio: new Date('2026-11-25T14:00:00-03:00'), duracao: 60, jornada, agora }), []);
  assert.ok(avisosDoHorario({ inicio: new Date('2026-11-25T23:00:00-03:00'), duracao: 30, jornada, agora }).some((a) => /fora do expediente/.test(a)));
  assert.ok(avisosDoHorario({ inicio: new Date('2026-11-29T10:00:00-03:00'), duracao: 30, jornada, agora }).some((a) => /não tem expediente/.test(a)));
  assert.ok(avisosDoHorario({ inicio: new Date('2020-01-01T10:00:00-03:00'), duracao: 30, agora }).some((a) => /já passou/.test(a)));
  const hf = { dias: [1, 2, 3, 4, 5], abertura: '08:00', fechamento: '18:00' };
  assert.ok(avisosDoHorario({ inicio: new Date('2026-11-29T10:00:00-03:00'), duracao: 30, horarioFuncionamento: hf, agora }).length === 1);
});

test('agendamento: campos validados, virgula e limites', () => {
  const base = { nomeCliente: 'Rita', data: '2026-12-15T13:00:00.000Z' };
  const ok = lerCamposAgendamento({ ...base, preco: '10,50', duracao: '45' });
  assert.strictEqual(ok.data.preco, 10.5);
  assert.strictEqual(ok.data.duracao, 45);
  assert.strictEqual(ok.data.origem, 'MANUAL');
  assert.strictEqual(lerCamposAgendamento(base).data.duracao, 30);
  assert.ok(lerCamposAgendamento({ ...base, preco: -80 }).erro);
  assert.ok(lerCamposAgendamento({ ...base, preco: 1e12 }).erro);
  assert.ok(lerCamposAgendamento({ ...base, duracao: -10 }).erro);
  assert.ok(lerCamposAgendamento({ ...base, duracao: 99999 }).erro);
  assert.ok(lerCamposAgendamento({ ...base, duracao: 'abc' }).erro);
  assert.ok(lerCamposAgendamento({ ...base, nomeCliente: '   ' }).erro);
  assert.ok(lerCamposAgendamento({ ...base, nomeCliente: ['x'] }).erro);
  assert.ok(lerCamposAgendamento({ ...base, nomeCliente: 'a'.repeat(6000) }).erro);
  assert.ok(lerCamposAgendamento({ ...base, observacoes: 'a'.repeat(6000) }).erro);
  assert.ok(lerCamposAgendamento({ ...base, telefoneCliente: 'lixo' }).erro);
  assert.ok(lerCamposAgendamento({ nomeCliente: 'Rita' }).erro, 'sem data');
  assert.strictEqual(lerCamposAgendamento({ ...base, status: 'COMPLETED' }).data.status, undefined, 'status no criar e ignorado');
  // edicao: so o que veio
  assert.deepStrictEqual(lerCamposAgendamento({ observacoes: 'oi' }, { parcial: true }).data, { observacoes: 'oi' });
  assert.ok(lerCamposAgendamento({ status: 'XYZ' }, { parcial: true }).erro);
  assert.ok(lerCamposAgendamento({ nomeCliente: null }, { parcial: true }).erro);
});

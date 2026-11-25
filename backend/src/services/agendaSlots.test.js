// Horarios livres: expediente padrao quando o negocio nunca salvou e o
// resumo de varios dias (faixa livre / poucos / lotado / fechado).
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('../prisma');
const { resumoDosDias, HORARIO_PADRAO, _internos } = require('./agendaSlots');

const { janelasDoDia } = _internos;
// Quarta 02/12/2026 e domingo 06/12/2026 (horario local).
const QUARTA = new Date(2026, 11, 2, 12);
const DOMINGO = new Date(2026, 11, 6, 12);
const AGORA = new Date(2026, 10, 25, 12);

test('sem horario salvo vale seg a sab, 08:00-18:00 (o que a tela mostra)', () => {
  assert.deepEqual(HORARIO_PADRAO.dias, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(janelasDoDia({ jornada: null, horarioFuncionamento: null, data: QUARTA }), [{ inicioMin: 480, fimMin: 1080 }]);
  assert.deepEqual(janelasDoDia({ jornada: null, horarioFuncionamento: null, data: DOMINGO }), []);
  // Salvo vale o salvo; jornada propria vale acima de tudo.
  assert.deepEqual(janelasDoDia({ horarioFuncionamento: { abertura: '09:00', fechamento: '12:00', dias: [3] }, data: QUARTA }), [{ inicioMin: 540, fimMin: 720 }]);
  assert.deepEqual(janelasDoDia({ jornada: { 3: [{ inicio: '14:00', fim: '15:00' }] }, horarioFuncionamento: null, data: QUARTA }), [{ inicioMin: 840, fimMin: 900 }]);
});

function stub({ especialistas, horario = null, agendamentos = [] }) {
  prisma.especialista.findMany = async ({ where }) => especialistas.filter((e) => where.id.in.includes(e.id));
  prisma.cliente.findUnique = async () => ({ horarioFuncionamento: horario });
  prisma.agendamento.findMany = async () => agendamentos;
}

test('resumo: dia fechado, livre, poucos e lotado', async () => {
  stub({ especialistas: [{ id: 'm', jornada: null }] });
  const [qua, dom] = await resumoDosDias({ clienteId: 'c', especialistaIds: ['m'], dias: [DOMINGO, QUARTA], duracao: 60, agora: AGORA });
  assert.equal(dom.status, 'fechado');
  assert.equal(qua.dia, '2026-12-02');
  assert.equal(qua.status, 'livre');
  assert.equal(qua.livres, 19); // 08:00..17:00 a cada 30 min, 1 h de servico

  // Ocupado das 08:00 as 16:30: sobram 16:30 e 17:00 -> "poucos".
  const ini = new Date(2026, 11, 2, 8, 0);
  stub({ especialistas: [{ id: 'm', jornada: null }], agendamentos: [{ especialistaId: 'm', data: ini, duracao: 510 }] });
  const [poucos] = await resumoDosDias({ clienteId: 'c', especialistaIds: ['m'], dias: [QUARTA], duracao: 60, agora: AGORA });
  assert.equal(poucos.status, 'poucos');
  assert.deepEqual(poucos.horarios.map((h) => new Date(h.inicio).getHours() * 60 + new Date(h.inicio).getMinutes()), [990, 1020]);

  stub({ especialistas: [{ id: 'm', jornada: null }], agendamentos: [{ especialistaId: 'm', data: ini, duracao: 600 }] });
  const [lotado] = await resumoDosDias({ clienteId: 'c', especialistaIds: ['m'], dias: [QUARTA], duracao: 60, agora: AGORA });
  assert.equal(lotado.status, 'lotado');
});

test('qualquer profissional: horario livre de um conta mesmo se o outro estiver ocupado', async () => {
  const ini = new Date(2026, 11, 2, 8, 0);
  stub({
    especialistas: [{ id: 'm', jornada: null }, { id: 'j', jornada: null }],
    agendamentos: [{ especialistaId: 'm', data: ini, duracao: 600 }],
  });
  const [r] = await resumoDosDias({ clienteId: 'c', especialistaIds: ['m', 'j'], dias: [QUARTA], duracao: 60, agora: AGORA });
  assert.equal(r.status, 'livre');
  assert.ok(r.horarios.every((h) => h.especialistaId === 'j'));
});

test('horario que ja passou nao entra', async () => {
  stub({ especialistas: [{ id: 'm', jornada: null }] });
  const agora = new Date(2026, 11, 2, 16, 10);
  const [r] = await resumoDosDias({ clienteId: 'c', especialistaIds: ['m'], dias: [QUARTA], duracao: 60, agora });
  assert.deepEqual(r.horarios.map((h) => new Date(h.inicio).getHours() * 60 + new Date(h.inicio).getMinutes()), [990, 1020]);
});

test('hoje depois do fechamento aparece como fechado, nao lotado', async () => {
  stub({ especialistas: [{ id: 'm', jornada: null }] });
  const [r] = await resumoDosDias({ clienteId: 'c', especialistaIds: ['m'], dias: [QUARTA], duracao: 60, agora: new Date(2026, 11, 2, 17, 30) }); // ultimo horario possivel (17:00) ja passou
  assert.equal(r.status, 'fechado');
});

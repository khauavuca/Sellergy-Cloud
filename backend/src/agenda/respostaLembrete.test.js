const test = require('node:test');
const assert = require('node:assert');
const prisma = require('../prisma');
const { interpretarResposta, escolherAgendamentoDoLembrete, tratarRespostaWhatsapp, JANELA_RESPOSTA_MS } = require('./respostaLembrete');

const agora = new Date('2026-11-24T15:00:00Z');
const horas = (h) => new Date(agora.getTime() + h * 3_600_000);
const ag = (id, extra) => ({
  id, clienteId: 'c1', status: 'PENDING', nomeCliente: 'Ana', telefoneCliente: '(11) 98888-7777',
  data: horas(20), lembrete24hEm: null, lembrete2hEm: null, ...extra,
});

test('"nao", "não" e "n" sozinhos nao cancelam: viram pergunta', () => {
  for (const t of ['nao', 'Não', 'n', 'não posso']) {
    assert.equal(interpretarResposta({ texto: t }).acao, 'NEGATIVA_AMBIGUA', t);
  }
  assert.equal(interpretarResposta({ texto: 'cancelar' }).acao, 'REMARCAR');
  assert.equal(interpretarResposta({ texto: 'ok' }), null); // "ok" solto nao confirma mais
});

test('vale so o lembrete MAIS RECENTE do telefone, dentro da janela curta', () => {
  const antigo = ag('antigo', { lembrete24hEm: horas(-10), data: horas(14) });
  const recente = ag('recente', { lembrete2hEm: horas(-1), data: horas(1) });
  const outroTel = ag('outro', { telefoneCliente: '11 97777-0000', lembrete2hEm: horas(-0.1) });
  assert.equal(escolherAgendamentoDoLembrete([antigo, recente, outroTel], '5511988887777', agora).id, 'recente');

  const foraDaJanela = ag('velho', { lembrete24hEm: new Date(agora.getTime() - JANELA_RESPOSTA_MS - 60_000) });
  assert.equal(escolherAgendamentoDoLembrete([foraDaJanela], '5511988887777', agora), null);

  const jaPassou = ag('passou', { lembrete2hEm: horas(-1), data: horas(-0.5) });
  assert.equal(escolherAgendamentoDoLembrete([jaPassou], '5511988887777', agora), null);
});

test('"não" depois do lembrete pede confirmacao e NAO mexe no agendamento', async () => {
  let atualizou = false;
  prisma.agendamento.findMany = async () => [ag('a1', { lembrete24hEm: horas(-2) })];
  prisma.agendamento.update = async () => { atualizou = true; };
  const r = await tratarRespostaWhatsapp({ clienteId: 'c1', de: '5511988887777', texto: 'não', agora });
  assert.equal(r.tratado, true);
  assert.match(r.resposta, /Responda \*2\* para remarcar/);
  assert.equal(atualizou, false);
});

test('"1" depois do lembrete confirma', async () => {
  // Relogio real aqui: aplicarResposta confere "horario ja passou" com Date.now().
  const real = Date.now();
  const updates = [];
  prisma.agendamento.findMany = async () => [ag('a2', { lembrete24hEm: new Date(real - 2 * 3_600_000), data: new Date(real + 20 * 3_600_000) })];
  prisma.agendamento.update = async (a) => { updates.push(a); };
  prisma.historicoAgendamento.create = async () => ({});
  const r = await tratarRespostaWhatsapp({ clienteId: 'c1', de: '5511988887777', texto: '1', agora: new Date(real) });
  assert.equal(r.tratado, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.status, 'CONFIRMED');
});

test('sem lembrete recente pra esse telefone, "2" segue pro bot (nao cancela nada)', async () => {
  let atualizou = false;
  prisma.agendamento.findMany = async () => [];
  prisma.agendamento.update = async () => { atualizou = true; };
  const r = await tratarRespostaWhatsapp({ clienteId: 'c1', de: '5511988887777', texto: '2', agora });
  assert.deepEqual(r, { tratado: false });
  assert.equal(atualizou, false);
});

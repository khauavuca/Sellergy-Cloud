// Tela "Nova campanha" em 4 passos: publico (aniversariantes, gasto minimo,
// quem fica de fora), texto com campos por cliente, agendamento e disparo
// com trava contra duplo.
const test = require('node:test');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste';
const assert = require('node:assert');
const prisma = require('../prisma');

const filas = require('../filas');
const enfileirados = [];
filas.enfileirarEnvioCampanha = async (id) => { enfileirados.push(id); };
filas.enfileirarEnvioCampanhaBaileys = async (id) => { enfileirados.push(`b:${id}`); };

const publico = require('./campanhaPublico');
const texto = require('./campanhaTexto');
const { dispararCampanha, dispararAgendadas } = require('./campanhaDisparo');
const rotas = require('../routes/campanhas.routes');

test('aniversariante do mes usa o mes de Brasilia', () => {
  // 01/12 02:00 UTC = 30/11 23:00 em Brasilia -> mes 10 (novembro)
  const agora = new Date('2026-12-01T02:00:00Z');
  assert.equal(publico.ehAniversarianteDoMes(new Date('1990-11-15T00:00:00Z'), agora), true);
  assert.equal(publico.ehAniversarianteDoMes(new Date('1990-12-15T00:00:00Z'), agora), false);
  assert.equal(publico.ehAniversarianteDoMes(null, agora), false);
});

test('gasto minimo: so quem passou do valor na ultima venda; sem venda sai', () => {
  const r = publico.filtrarPorGastoMinimo(['a', 'b', 'c'], [{ leadId: 'a', valor: 150 }, { leadId: 'b', valor: 100 }], 100);
  assert.deepEqual(r, ['a']);
  assert.deepEqual(publico.filtrarPorGastoMinimo(['a', 'c'], [], null), ['a', 'c']);
});

test('separarPublico tira quem pediu SAIR e quem nao tem telefone', () => {
  const r = publico.separarPublico(
    [{ id: '1', telefone: '(62) 99999-0001' }, { id: '2', telefone: '62999990002' }, { id: '3', telefone: null }, { id: '4', telefone: '123' }],
    new Set(['5562999990002']),
  );
  assert.deepEqual(r, { recebem: ['1'], semPermissao: 1, semTelefone: 2 });
});

test('texto: troca os campos, usa reserva e poe link + SAIR no QR Code', () => {
  const msg = 'Oi, [nome]! Seu [último serviço] com [profissional]. Cupom [cupom]. [link de agendamento]';
  const dados = { nome: 'Débora', ultimoServico: 'corte', profissional: '', cupom: 'VOLTA15', link: 'https://x/agendar/s' };
  assert.equal(texto.preencherTexto(msg, dados), 'Oi, Débora! Seu corte com nossa equipe. Cupom VOLTA15. https://x/agendar/s');
  assert.deepEqual([...texto.camposUsados(msg)].sort(), ['cupom', 'link', 'nome', 'profissional', 'ultimoServico']);
  const final = texto.textoQrCode('Oi, [nome]', { nome: 'Ana', link: 'https://x/agendar/s' }, 'MARCAR_HORARIO');
  assert.equal(final, `Oi, Ana\n\nMarcar horário: https://x/agendar/s\n\n${texto.RODAPE_SAIR}`);
});

test('texto: parametros da Meta na ordem e nunca vazios', () => {
  const c = texto.componentesMeta('[cupom] para [nome]', { nome: 'Ana' });
  assert.deepEqual(c, [{ type: 'body', parameters: [{ type: 'text', text: '-' }, { type: 'text', text: 'Ana' }] }]);
  assert.equal(texto.componentesMeta('sem campos', {}), undefined);
});

test('rota: gasto minimo e data do agendamento validados', () => {
  assert.deepEqual(rotas.lerGastoMinimo(''), { ok: true, valor: null });
  assert.deepEqual(rotas.lerGastoMinimo('100,50'), { ok: true, valor: 100.5 });
  assert.equal(rotas.lerGastoMinimo('-3').ok, false);
  assert.equal(rotas.lerGastoMinimo('abc').ok, false);
  const agora = new Date('2026-11-25T12:00:00Z');
  assert.equal(rotas.lerAgendadoPara('2026-11-26T10:00:00.000Z', agora).ok, true);
  assert.equal(rotas.lerAgendadoPara('2026-11-25T12:00:30Z', agora).ok, false); // menos de 2 min
  assert.equal(rotas.lerAgendadoPara('2027-03-01T10:00:00Z', agora).ok, false); // mais de 60 dias
  assert.equal(rotas.lerAgendadoPara('amanha', agora).ok, false);
  assert.equal(rotas.lerAgendadoPara({ $gt: 1 }, agora).ok, false);
});

function mockarDisparo({ campanha, bot = { provedorCanal: 'META_CLOUD' }, travaCount = 1 } = {}) {
  const chamadas = { findFirst: [], updateMany: [] };
  prisma.campanha.findFirst = async (q) => { chamadas.findFirst.push(q.where); return campanha && q.where.clienteId === campanha.clienteId ? campanha : null; };
  prisma.bot.findFirst = async () => bot;
  prisma.venda.groupBy = async () => [
    { leadId: 'l1', _max: { data: new Date('2020-01-01') } },
    { leadId: 'l2', _max: { data: new Date('2020-01-01') } },
  ];
  prisma.lead.findMany = async () => [{ id: 'l1', telefone: '62999990001' }, { id: 'l2', telefone: '62999990002' }];
  prisma.optOutWhatsapp.findMany = async () => [{ telefone: '5562999990002' }];
  prisma.campanha.updateMany = async (q) => { chamadas.updateMany.push(q); return { count: travaCount }; };
  prisma.campanhaEnvio.upsert = (q) => ({ id: `env-${q.create.leadId}`, status: 'PENDENTE' });
  prisma.$transaction = async (ops) => Promise.all(ops);
  prisma.campanha.update = async () => ({});
  return chamadas;
}

const CAMPANHA = { id: 'k1', clienteId: 'c1', status: 'RASCUNHO', segmento: 'recompra', diasRecompra: 30, nomeTemplate: 'volta', gastoMinimo: null };

test('disparo: campanha de outro negocio = 404 (filtra clienteId)', async () => {
  const ch = mockarDisparo({ campanha: CAMPANHA });
  const r = await dispararCampanha({ clienteId: 'outro', campanhaId: 'k1' });
  assert.equal(r.status, 404);
  assert.equal(ch.findFirst[0].clienteId, 'outro');
});

test('disparo: quem pediu SAIR nem entra na fila', async () => {
  enfileirados.length = 0;
  mockarDisparo({ campanha: CAMPANHA });
  const r = await dispararCampanha({ clienteId: 'c1', campanhaId: 'k1' });
  assert.equal(r.ok, true);
  assert.equal(r.totalAlvo, 1);
  assert.equal(r.ficaramDeFora, 1);
  assert.deepEqual(enfileirados, ['env-l1']);
});

test('disparo: trava contra clique duplo (so um tira de RASCUNHO)', async () => {
  enfileirados.length = 0;
  const ch = mockarDisparo({ campanha: CAMPANHA, travaCount: 0 });
  const r = await dispararCampanha({ clienteId: 'c1', campanhaId: 'k1' });
  assert.equal(r.ok, false);
  assert.equal(enfileirados.length, 0);
  assert.deepEqual(ch.updateMany[0].where, { id: 'k1', clienteId: 'c1', status: 'RASCUNHO' });
});

test('disparo oficial sem modelo da Meta nao sai', async () => {
  mockarDisparo({ campanha: { ...CAMPANHA, nomeTemplate: null } });
  const r = await dispararCampanha({ clienteId: 'c1', campanhaId: 'k1' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.campos, ['nomeTemplate']);
});

test('agendadas: a que nao pode sair perde o agendamento e avisa', async () => {
  const ch = mockarDisparo({ campanha: { ...CAMPANHA, nomeTemplate: null } });
  prisma.campanha.findMany = async (q) => {
    assert.equal(q.where.status, 'RASCUNHO');
    return [{ id: 'k1', clienteId: 'c1', nome: 'Volta' }];
  };
  const avisos = [];
  const r = await dispararAgendadas({ agora: new Date(), avisar: async (n) => { avisos.push(n); } });
  assert.equal(r[0].ok, false);
  assert.deepEqual(ch.updateMany.at(-1).data, { agendadoPara: null });
  assert.equal(avisos[0].clienteId, 'c1');
});

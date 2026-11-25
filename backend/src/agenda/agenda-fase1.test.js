const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste';
const { lembreteDevido, configLembreteEfetiva, montarTextoLembrete, componentesTemplate, gerarTokenConfirmacao } = require('./lembretes');
const { interpretarResposta } = require('./respostaLembrete');

const HORA = 3600 * 1000;
const agora = new Date('2026-11-21T12:00:00Z');
const ag = (horasAte, extra = {}) => ({
  telefoneCliente: '11988887777', status: 'PENDING', data: new Date(agora.getTime() + horasAte * HORA),
  lembrete24hEm: null, lembrete2hEm: null, ...extra,
});

test('24 h antes manda o lembrete de 24h', () => {
  assert.equal(lembreteDevido(ag(23.5), agora), '24h');
});

test('perto do horario manda o de 2h e pula o de 24h', () => {
  assert.equal(lembreteDevido(ag(1.5), agora), '2h');
});

test('nao repete o que ja foi enviado', () => {
  assert.equal(lembreteDevido(ag(23, { lembrete24hEm: agora }), agora), null);
  assert.equal(lembreteDevido(ag(1.5, { lembrete2hEm: agora }), agora), null);
});

test('confirmado recebe o de 24h mas nao o de 2h', () => {
  assert.equal(lembreteDevido(ag(20, { status: 'CONFIRMED' }), agora), '24h');
  assert.equal(lembreteDevido(ag(1.5, { status: 'CONFIRMED' }), agora), null);
});

test('sem telefone, cancelado, longe demais ou ja passou: nada', () => {
  assert.equal(lembreteDevido(ag(20, { telefoneCliente: null }), agora), null);
  assert.equal(lembreteDevido(ag(20, { status: 'CANCELED' }), agora), null);
  assert.equal(lembreteDevido(ag(30), agora), null);
  assert.equal(lembreteDevido(ag(-1), agora), null);
  assert.equal(lembreteDevido(ag(0.1), agora), null); // menos de 20 min: tarde demais
});

test('marcado em cima da hora (entre 3h e 20min) so leva o de 2h', () => {
  assert.equal(lembreteDevido(ag(2.5), agora), null);
  assert.equal(lembreteDevido(ag(1), agora), '2h');
});

test('respeita antecedencias desligadas na config', () => {
  assert.equal(lembreteDevido(ag(1.5), agora, ['24h']), null);
});

test('config: mescla com o padrao e descarta valores invalidos', () => {
  assert.deepEqual(configLembreteEfetiva(null).antecedencias, ['24h', '2h']);
  const c = configLembreteEfetiva({ ativo: false, nomeTemplate: 'Nome Invalido!', antecedencias: ['2h', 'xx'] });
  assert.equal(c.ativo, false);
  assert.equal(c.nomeTemplate, 'lembrete_agendamento');
  assert.deepEqual(c.antecedencias, ['2h']);
});

test('texto do lembrete tem nome, negocio, hora e o link', () => {
  const t = montarTextoLembrete({
    nomeNegocio: 'Clínica Bem Estar', nomeCliente: 'Maria Souza', data: new Date('2026-11-22T13:30:00Z'),
    servico: 'Limpeza de pele', profissional: 'Ana', link: 'https://x/confirmar/abc',
  });
  assert.match(t, /Maria/);
  assert.match(t, /Clínica Bem Estar/);
  assert.match(t, /10:30/); // 13:30 UTC = 10:30 em Sao Paulo
  assert.match(t, /https:\/\/x\/confirmar\/abc/);
});

test('template oficial leva os botoes com o token no payload', () => {
  const comps = componentesTemplate({ nomeNegocio: 'X', nomeCliente: 'Ana', data: agora, token: 'tok_123456789' });
  const botoes = comps.filter((c) => c.type === 'button').map((c) => c.parameters[0].payload);
  assert.deepEqual(botoes, ['CONFIRMAR:tok_123456789', 'REMARCAR:tok_123456789']);
});

test('token de confirmacao e aleatorio e seguro para URL', () => {
  const a = gerarTokenConfirmacao();
  assert.match(a, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(a, gerarTokenConfirmacao());
});

test('interpretar resposta: botoes, 1/2 e palavras curtas', () => {
  assert.deepEqual(interpretarResposta({ payload: 'CONFIRMAR:tok_123456789' }), { acao: 'CONFIRMAR', token: 'tok_123456789' });
  assert.deepEqual(interpretarResposta({ texto: ' 1 ' }), { acao: 'CONFIRMAR', token: null });
  assert.deepEqual(interpretarResposta({ texto: 'Sim!' }), { acao: 'CONFIRMAR', token: null });
  assert.deepEqual(interpretarResposta({ texto: '2' }), { acao: 'REMARCAR', token: null });
  assert.deepEqual(interpretarResposta({ texto: 'Não' }), { acao: 'NEGATIVA_AMBIGUA', token: null }); // "não" sozinho não cancela
});

test('conversa normal nao vira confirmacao', () => {
  assert.equal(interpretarResposta({ texto: 'sim, mas queria saber o preço' }), null);
  assert.equal(interpretarResposta({ texto: 'oi' }), null);
  assert.equal(interpretarResposta({ payload: 'CONFIRMAR:' }), null);
});

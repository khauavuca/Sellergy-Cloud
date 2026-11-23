const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste';
const { PLANOS, planosPublicos, PLANO_DO_TRIAL } = require('./catalogo');
const { temRecurso, limiteDo, planoMaisBaratoCom } = require('./recursos');
const { situacaoAssinatura, proximoStatusPorFaturas, DIA_MS } = require('../assinatura/situacao');

const agora = new Date('2026-11-21T12:00:00Z');

test('precos fixos da proposta: 59, 119, 199', () => {
  assert.deepEqual(Object.values(PLANOS).map((p) => p.precoMensal), [59, 119, 199]);
});

test('planosPublicos e serializavel e traz preco anual com 20% de desconto', () => {
  const publicos = JSON.parse(JSON.stringify(planosPublicos()));
  assert.equal(publicos.length, 3);
  assert.equal(publicos[0].precoAnualMensal, 47.2);
});

test('Essencial nao tem campanhas nem link; Profissional tem', () => {
  const essencial = { plano: 'BASIC', statusAssinatura: 'ATIVA' };
  const pro = { plano: 'PRO', statusAssinatura: 'ATIVA' };
  assert.equal(temRecurso(essencial, 'campanhas', agora), false);
  assert.equal(temRecurso(essencial, 'linkAgendamento', agora), false);
  assert.equal(temRecurso(pro, 'campanhas', agora), true);
  assert.equal(limiteDo(essencial, 'profissionais', agora), 2);
});

test('durante o teste vale o plano Profissional, mesmo contratado Essencial', () => {
  const trial = { plano: 'BASIC', statusAssinatura: 'TRIAL', trialAte: new Date(agora.getTime() + 5 * DIA_MS) };
  assert.equal(PLANO_DO_TRIAL, 'PRO');
  assert.equal(temRecurso(trial, 'linkAgendamento', agora), true);
  assert.equal(limiteDo(trial, 'profissionais', agora), 5);
});

test('plano sugerido para um recurso e o mais barato que o tem', () => {
  assert.equal(planoMaisBaratoCom((p) => p.recursos.campanhas), 'PRO');
  assert.equal(planoMaisBaratoCom((p) => p.recursos.atendimentoIa), 'PREMIUM');
});

test('situacao: trial em dia, acabando e vencido', () => {
  const emDia = situacaoAssinatura({ statusAssinatura: 'TRIAL', trialAte: new Date(agora.getTime() + 10 * DIA_MS) }, agora);
  assert.equal(emDia.podeOperar, true);
  assert.equal(emDia.diasRestantesTrial, 10);
  assert.equal(emDia.aviso, null);

  const acabando = situacaoAssinatura({ statusAssinatura: 'TRIAL', trialAte: new Date(agora.getTime() + 2 * DIA_MS) }, agora);
  assert.equal(acabando.aviso, 'TRIAL_ACABANDO');

  const vencido = situacaoAssinatura({ statusAssinatura: 'TRIAL', trialAte: new Date(agora.getTime() - 1000) }, agora);
  assert.equal(vencido.somenteLeitura, true);
  assert.equal(vencido.aviso, 'TRIAL_VENCIDO');
});

test('situacao: atrasada opera com aviso; suspensa so le', () => {
  assert.equal(situacaoAssinatura({ statusAssinatura: 'ATRASADA' }, agora).podeOperar, true);
  const suspensa = situacaoAssinatura({ statusAssinatura: 'SUSPENSA' }, agora);
  assert.equal(suspensa.somenteLeitura, true);
  assert.equal(suspensa.aviso, 'CONTA_SUSPENSA');
});

test('status pelas faturas: em dia, atrasada, suspensa aos 10 dias', () => {
  assert.equal(proximoStatusPorFaturas({ statusAtual: 'ATRASADA', faturaVencidaMaisAntiga: null, agora }), 'ATIVA');
  assert.equal(proximoStatusPorFaturas({ statusAtual: 'ATIVA', faturaVencidaMaisAntiga: new Date(agora.getTime() - 3 * DIA_MS), agora }), 'ATRASADA');
  assert.equal(proximoStatusPorFaturas({ statusAtual: 'ATRASADA', faturaVencidaMaisAntiga: new Date(agora.getTime() - 10 * DIA_MS), agora }), 'SUSPENSA');
  assert.equal(proximoStatusPorFaturas({ statusAtual: 'TRIAL', faturaVencidaMaisAntiga: new Date(0), agora }), 'TRIAL');
});

// Regras puras da fase 2 da agenda: fila de encaixe, sinal, pacotes, comissoes.
const test = require('node:test');
const assert = require('node:assert/strict');

const { filaServeVaga, escolherCandidatos, expiraEmOferta, deveOfertarSozinho, normalizarEntradaFila } = require('./encaixe');
const { percentualSinal, valorSinal, prazoDoSinal, valorAposSinal } = require('./sinal');
const { saldoPacote, situacaoPacote, estaAcabando, valorPorSessao, valorParcela, podeUsarPacote, validoAteDe } = require('./pacotes');
const { calcularComissaoAtendimento, regraTexto, resumirPessoa } = require('./comissoes');
const { partesBRT, competenciaBRT, intervaloCompetencia, servicoBase, mesmoTelefone } = require('./utilAgenda');

// Quarta, 25/11/2026 16:00 em Brasilia (19:00Z).
const VAGA = { data: new Date('2026-11-25T19:00:00Z'), servico: 'Peeling químico - Rosto', especialistaId: 'carla' };
const AGORA = new Date('2026-11-25T17:00:00Z'); // 14:00 BRT
const pessoa = (extra = {}) => ({ id: extra.id || 'p1', status: 'AGUARDANDO', nome: 'Renata', telefone: '11999990001', criadoEm: new Date('2026-11-20T12:00:00Z'), ...extra });

test('utilAgenda: fuso de Brasilia, competencia e nome-base do servico', () => {
  const p = partesBRT(VAGA.data);
  assert.equal(p.hhmm, '16:00');
  assert.equal(p.diaSemana, 3);
  assert.equal(p.ymd, '2026-11-25');
  assert.equal(competenciaBRT(new Date('2026-12-01T02:00:00Z')), '2026-11'); // 23:00 BRT do dia 30
  const i = intervaloCompetencia('2026-12');
  assert.equal(i.inicio.toISOString(), '2026-12-01T03:00:00.000Z');
  assert.equal(i.fim.toISOString(), '2027-01-01T03:00:00.000Z');
  assert.equal(intervaloCompetencia('2026-13'), null);
  assert.equal(servicoBase('Peeling Químico — Rosto'), 'peeling quimico');
  assert.equal(servicoBase('Peeling químico'), 'peeling quimico');
  assert.ok(mesmoTelefone('(11) 99999-0001', '5511999990001'));
  assert.ok(!mesmoTelefone('', ''));
});

test('encaixe: quem serve pra vaga (servico, profissional, dia, horario, validade)', () => {
  const ctx = { agora: AGORA };
  assert.ok(filaServeVaga(pessoa(), VAGA, ctx), 'sem preferencia serve pra tudo');
  assert.ok(filaServeVaga(pessoa({ produtoNome: 'Peeling químico' }), VAGA, ctx), 'mesmo servico');
  assert.ok(!filaServeVaga(pessoa({ produtoNome: 'Limpeza de pele' }), VAGA, ctx), 'outro servico');
  assert.ok(filaServeVaga(pessoa({ especialistaId: 'carla' }), VAGA, ctx));
  assert.ok(!filaServeVaga(pessoa({ especialistaId: 'ana' }), VAGA, ctx), 'outra profissional');
  assert.ok(filaServeVaga(pessoa({ diasSemana: [3, 4] }), VAGA, ctx), 'quarta incluida');
  assert.ok(!filaServeVaga(pessoa({ diasSemana: [1, 2] }), VAGA, ctx), 'so seg/ter');
  assert.ok(filaServeVaga(pessoa({ horaInicio: '14:00', horaFim: '18:00' }), VAGA, ctx));
  assert.ok(!filaServeVaga(pessoa({ horaInicio: '08:00', horaFim: '12:00' }), VAGA, ctx), 'so manha');
  assert.ok(!filaServeVaga(pessoa({ horaInicio: '08:00', horaFim: '16:00' }), VAGA, ctx), 'fim exclusivo');
  assert.ok(filaServeVaga(pessoa({ ate: new Date('2026-11-25T03:00:00Z') }), VAGA, ctx), 'ate o dia da vaga (dia inteiro)');
  assert.ok(!filaServeVaga(pessoa({ ate: new Date('2026-11-24T12:00:00Z') }), VAGA, ctx), 'validade vencida');
  assert.ok(!filaServeVaga(pessoa({ status: 'OFERTADO' }), VAGA, ctx), 'ja tem oferta aberta');
  assert.ok(!filaServeVaga(pessoa(), VAGA, { agora: new Date('2026-11-25T20:00:00Z') }), 'vaga ja passou');
  assert.ok(!filaServeVaga(pessoa(), VAGA, { agora: AGORA, telefoneExcluir: '(11) 99999-0001' }), 'quem largou a vaga');
});

test('encaixe: ate 3 candidatos, na ordem de entrada', () => {
  const fila = [
    pessoa({ id: 'd', criadoEm: new Date('2026-11-23T10:00:00Z') }),
    pessoa({ id: 'a', criadoEm: new Date('2026-11-20T10:00:00Z') }),
    pessoa({ id: 'x', criadoEm: new Date('2026-11-19T10:00:00Z'), produtoNome: 'Massagem' }),
    pessoa({ id: 'c', criadoEm: new Date('2026-11-22T10:00:00Z') }),
    pessoa({ id: 'b', criadoEm: new Date('2026-11-21T10:00:00Z') }),
  ];
  assert.deepEqual(escolherCandidatos(fila, VAGA, { agora: AGORA }).map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(escolherCandidatos(fila, VAGA, { agora: AGORA, excluirIds: ['a'] }).map((p) => p.id), ['b', 'c', 'd']);
});

test('encaixe: validade da oferta e automatico so com +2 h', () => {
  assert.equal(expiraEmOferta({ agora: AGORA, dataVaga: VAGA.data }).toISOString(), '2026-11-25T17:30:00.000Z');
  assert.equal(expiraEmOferta({ agora: new Date('2026-11-25T18:50:00Z'), dataVaga: VAGA.data }).toISOString(), VAGA.data.toISOString());
  assert.ok(deveOfertarSozinho({ encaixeAutomatico: true, dataVaga: VAGA.data, agora: AGORA }));
  assert.ok(!deveOfertarSozinho({ encaixeAutomatico: true, dataVaga: VAGA.data, agora: new Date('2026-11-25T17:30:00Z') }));
  assert.ok(!deveOfertarSozinho({ encaixeAutomatico: false, dataVaga: VAGA.data, agora: AGORA }));
});

test('encaixe: entrada na fila valida campos', () => {
  const ok = normalizarEntradaFila({ nome: ' Paula ', telefone: '(11) 98888-7777', diasSemana: [3, 1, 3], horaInicio: '14:00', horaFim: '18:00', ate: '2026-12-10' }, { agora: AGORA });
  assert.equal(ok.dados.nome, 'Paula');
  assert.equal(ok.dados.telefone, '11988887777');
  assert.deepEqual(ok.dados.diasSemana, [1, 3]);
  const ruim = normalizarEntradaFila({ nome: 'P', telefone: '123', horaInicio: '18:00', horaFim: '14:00', ate: '2026-11-01', diasSemana: [9] }, { agora: AGORA });
  assert.deepEqual(ruim.campos.sort(), ['ate', 'diasSemana', 'horaFim', 'nome', 'telefone']);
});

test('sinal: percentual, valor e prazo (4 h, nunca depois do horario)', () => {
  assert.equal(percentualSinal({ pctServico: null, pctNegocio: 30 }), 30);
  assert.equal(percentualSinal({ pctServico: 0, pctNegocio: 30 }), 0, '0 no servico = nao cobra');
  assert.equal(percentualSinal({ pctServico: 50, pctNegocio: 30 }), 50);
  assert.equal(percentualSinal({}), 0);
  assert.equal(valorSinal({ preco: 180, pct: 30 }), 54);
  assert.equal(valorSinal({ preco: 2, pct: 30 }), 0, 'abaixo de R$ 1 nao cobra');
  const agora = new Date('2026-11-23T15:12:00Z');
  assert.equal(prazoDoSinal({ agora, dataAgendamento: new Date('2026-11-25T16:30:00Z') }).toISOString(), '2026-11-23T19:12:00.000Z');
  assert.equal(prazoDoSinal({ agora, dataAgendamento: new Date('2026-11-23T17:00:00Z') }).toISOString(), '2026-11-23T17:00:00.000Z', 'nunca depois do horario');
  assert.equal(prazoDoSinal({ agora, dataAgendamento: new Date('2026-11-23T15:30:00Z') }), null, 'em cima da hora nao cobra');
  assert.equal(valorAposSinal({ preco: 180, sinalValor: 54, sinalStatus: 'PAGO' }), 126);
  assert.equal(valorAposSinal({ preco: 180, sinalValor: 54, sinalStatus: 'PENDENTE' }), 180);
  assert.equal(valorAposSinal({ preco: 40, sinalValor: 54, sinalStatus: 'PAGO' }), 0);
});

test('pacotes: saldo, situacao, acabando, parcelas e uso', () => {
  const agora = new Date('2026-11-23T12:00:00Z');
  const p = { sessoesTotal: 10, sessoesUsadas: 4, valor: 1200, validoAte: new Date('2027-03-23T12:00:00Z'), status: 'ATIVO' };
  assert.equal(saldoPacote(p), 6);
  assert.equal(situacaoPacote(p, agora), 'ATIVO');
  assert.equal(valorPorSessao(p), 120);
  assert.ok(!estaAcabando(p, agora));
  assert.ok(estaAcabando({ ...p, sessoesUsadas: 8 }, agora), '2 sessoes');
  assert.ok(estaAcabando({ ...p, validoAte: new Date('2026-12-10T12:00:00Z') }, agora), 'vence em menos de 30 dias');
  assert.equal(situacaoPacote({ ...p, sessoesUsadas: 10 }, agora), 'ACABOU');
  assert.equal(situacaoPacote({ ...p, validoAte: new Date('2026-11-01T00:00:00Z') }, agora), 'VENCIDO');
  assert.deepEqual([1, 2, 3].map((i) => valorParcela(1000, 3, i)), [333.33, 333.33, 333.34]);
  assert.equal(validoAteDe(new Date('2026-11-23T12:00:00Z'), 30).toISOString(), '2026-12-24T02:59:59.000Z');

  const base = { pacote: p, servico: 'Drenagem - 60 min', servicoPacote: 'Drenagem', dataAgendamento: new Date('2026-12-01T12:00:00Z'), agora };
  assert.ok(podeUsarPacote(base).ok);
  assert.ok(!podeUsarPacote({ ...base, servico: 'Massagem' }).ok);
  assert.ok(!podeUsarPacote({ ...base, reservados: 6 }).ok, 'tudo ja reservado');
  assert.ok(!podeUsarPacote({ ...base, dataAgendamento: new Date('2027-04-01T12:00:00Z') }).ok, 'depois da validade');
  assert.ok(!podeUsarPacote({ ...base, intervaloMinDias: 21, ultimoUso: new Date('2026-11-20T12:00:00Z') }).ok, 'intervalo minimo');
  assert.ok(podeUsarPacote({ ...base, intervaloMinDias: 7, ultimoUso: new Date('2026-11-20T12:00:00Z') }).ok);
});

test('comissoes: calculo, regra e fechamento', () => {
  assert.equal(calcularComissaoAtendimento({ pct: 20, base: 350 }), 70);
  assert.equal(calcularComissaoAtendimento({ fixa: 35, base: 120 }), 35);
  assert.equal(calcularComissaoAtendimento({ pct: 15, fixa: 5, base: 180 }), 32);
  assert.equal(calcularComissaoAtendimento({ pct: 0, base: 100 }), 0);
  assert.equal(regraTexto({ comissaoServicoPct: 20, comissaoProdutoPct: 5 }), '20% dos serviços · 5% dos produtos');
  assert.equal(regraTexto({ comissaoFixa: 35 }).replace(/\s/g, ' '), 'R$ 35,00 por atendimento');
  assert.equal(regraTexto({}), 'Sem regra de comissão');

  const r = resumirPessoa([
    { tipo: 'ATENDIMENTO', descricao: 'Peeling - Rosto', base: 350, valor: 70, status: 'A_PAGAR' },
    { tipo: 'ATENDIMENTO', descricao: 'Peeling — Costas', base: 350, valor: 70, status: 'PAGA' },
    { tipo: 'ATENDIMENTO', descricao: 'Limpeza de pele', base: 180, valor: 36, status: 'A_PAGAR' },
    { tipo: 'ATENDIMENTO', descricao: 'Limpeza de pele', base: 180, valor: 36, status: 'CANCELADA' },
    { id: 'v', tipo: 'VALE', descricao: 'Vale', base: 0, valor: -50, status: 'A_PAGAR' },
  ]);
  assert.equal(r.linhas.length, 2);
  assert.deepEqual(r.linhas[0], { titulo: 'Peeling', quantidade: 2, base: 700, valor: 140 });
  assert.equal(r.total, 126);
  assert.equal(r.pago, 70);
  assert.equal(r.aPagar, 56);
  assert.equal(r.baseServicos, 880);
  assert.equal(r.atendimentos, 3);
});

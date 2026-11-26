// Testes da emissao com o Prisma trocado por um falso em memoria (sem banco).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const caminhoPrisma = require.resolve(path.join(__dirname, '..', 'prisma'));
const fake = {
  documentoFiscal: {},
  documentoFiscalItem: {},
  configuracaoFiscal: {},
  cliente: {},
};
require.cache[caminhoPrisma] = { id: caminhoPrisma, filename: caminhoPrisma, loaded: true, exports: fake };

const {
  criarDocumentoUnico, sincronizarProcessando, mensagemFalhaEmissor, reservarNumero,
  codigosFiscaisConhecidos, destinatarioDoLead,
} = require('./emissao');

function erroUnico() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

test('trava unica: venda que ja tem nota viva devolve a existente sem criar', async () => {
  let criou = false;
  fake.documentoFiscal.findFirst = async ({ where }) => {
    assert.deepStrictEqual(where.status, { in: ['PENDENTE', 'PROCESSANDO', 'EMITIDA'] });
    return { id: 'antigo', status: 'EMITIDA' };
  };
  fake.documentoFiscal.create = async () => { criou = true; return {}; };
  const r = await criarDocumentoUnico({ clienteId: 'c1', vendaId: 'v1', tipo: 'NFCE', status: 'PENDENTE' });
  assert.strictEqual(r.existente, true);
  assert.strictEqual(r.doc.id, 'antigo');
  assert.strictEqual(criou, false);
});

test('trava unica: corrida (P2002 no create) devolve o documento que ganhou', async () => {
  let consultas = 0;
  fake.documentoFiscal.findFirst = async () => { consultas += 1; return consultas === 1 ? null : { id: 'vencedor', status: 'PENDENTE' }; };
  fake.documentoFiscal.create = async () => { throw erroUnico(); };
  const r = await criarDocumentoUnico({ clienteId: 'c1', vendaId: 'v1', tipo: 'NFSE', status: 'PENDENTE' });
  assert.deepStrictEqual(r, { doc: { id: 'vencedor', status: 'PENDENTE' }, existente: true });
});

test('trava unica: nota avulsa (sem venda) cria direto; outro erro sobe', async () => {
  fake.documentoFiscal.findFirst = async () => { throw new Error('nao deveria consultar'); };
  fake.documentoFiscal.create = async ({ data }) => ({ id: 'novo', ...data });
  const r = await criarDocumentoUnico({ clienteId: 'c1', vendaId: null, tipo: 'NFSE', status: 'PENDENTE' });
  assert.strictEqual(r.existente, false);
  assert.strictEqual(r.doc.id, 'novo');

  fake.documentoFiscal.findFirst = async () => null;
  fake.documentoFiscal.create = async () => { throw new Error('banco fora'); };
  await assert.rejects(() => criarDocumentoUnico({ clienteId: 'c1', vendaId: 'v2', tipo: 'NFCE' }), /banco fora/);
});

test('mensagem do erro do emissor chega na tela (sem esconder o motivo)', () => {
  assert.strictEqual(
    mensagemFalhaEmissor({ status: 502, mensagemEmissor: 'Rejeicao 778: NCM inexistente' }),
    'O emissor recusou: Rejeicao 778: NCM inexistente',
  );
  assert.match(mensagemFalhaEmissor({ status: 422, message: 'Falta para emitir a nota: produto "X" sem NCM.' }), /produto "X" sem NCM/);
  assert.match(mensagemFalhaEmissor({ codigo: 'FISCAL_TOKEN_VENCIDO', status: 502, message: 'O token da Nuvem Fiscal venceu' }), /token/);
  assert.match(mensagemFalhaEmissor({ codigo: 'TIMEOUT' }), /demorou/);
  assert.strictEqual(mensagemFalhaEmissor({ status: 502 }), 'O emissor não respondeu ou recusou o acesso.');
});

test('reservarNumero incrementa no banco e devolve o numero reservado', async () => {
  fake.configuracaoFiscal.update = async ({ data }) => {
    assert.deepStrictEqual(data, { proximoNumero: { increment: 1 } });
    return { proximoNumero: 43 };
  };
  assert.strictEqual(await reservarNumero('c1'), 42);
});

test('NCM/CFOP ja usados pelo produto em notas anteriores completam a venda', async () => {
  fake.documentoFiscalItem.findMany = async () => [
    { produtoId: 'p1', ncm: '33051000', cfop: null, cest: null },
    { produtoId: 'p1', ncm: '99999999', cfop: '5102', cest: null },
  ];
  const mapa = await codigosFiscaisConhecidos('c1', ['p1', 'p1', null]);
  assert.deepStrictEqual(mapa.get('p1'), { ncm: '33051000', cfop: '5102', cest: null });
  assert.strictEqual((await codigosFiscaisConhecidos('c1', [])).size, 0);
  assert.deepStrictEqual(destinatarioDoLead({ nome: 'Ana', cpf: '52998224725', email: null }), { nome: 'Ana', documento: '52998224725', email: null });
  assert.strictEqual(destinatarioDoLead(null), null);
});

test('sincronizacao: so PROCESSANDO antigos, com limite, e falha nao para a rodada', async () => {
  const agora = new Date('2026-11-24T12:00:00Z');
  let consulta;
  const docs = [
    { id: 'd1', clienteId: 'c1', tipo: 'NFCE', status: 'PROCESSANDO', provedorDocId: 'r1' },
    { id: 'd2', clienteId: 'c1', tipo: 'NFSE', status: 'PROCESSANDO', provedorDocId: 'r2' },
    { id: 'd3', clienteId: 'c2', tipo: 'NFCE', status: 'PROCESSANDO', provedorDocId: 'r3' },
  ];
  const atualizacoes = [];
  const db = {
    documentoFiscal: {
      findMany: async (q) => { consulta = q; return docs; },
      update: async ({ where, data }) => { atualizacoes.push({ id: where.id, ...data }); return { id: where.id, ...data }; },
    },
  };
  fake.documentoFiscal.update = db.documentoFiscal.update; // aplicarDocumento usa o prisma do modulo
  const chamadas = [];
  const emissorC1 = {
    consultarStatus: async (id, tipo) => {
      chamadas.push([id, tipo]);
      if (id === 'r1') return { provedorDocId: 'r1', status: 'EMITIDA', numero: '10' };
      throw Object.assign(new Error('x'), { status: 502, mensagemEmissor: 'fora do ar' });
    },
  };
  const obterEmissor = async (clienteId) => {
    if (clienteId === 'c2') throw new Error('Fiscal nao configurado');
    return { emissor: emissorC1 };
  };
  const r = await sincronizarProcessando({ agora, minutos: 10, limite: 3, db, obterEmissor });
  assert.deepStrictEqual(consulta.where.status, { in: ['PROCESSANDO', 'PENDENTE'] });
  assert.deepStrictEqual(consulta.where.provedorDocId, { not: null });
  assert.strictEqual(consulta.where.atualizadoEm.lt.toISOString(), '2026-11-24T11:50:00.000Z');
  assert.strictEqual(consulta.take, 3);
  assert.deepStrictEqual(chamadas, [['r1', 'NFCE'], ['r2', 'NFSE']]);
  assert.deepStrictEqual(r, { consultados: 1, emitidos: 1, erros: 0, falhas: 2 });
  assert.ok(atualizacoes.some((u) => u.id === 'd1' && u.status === 'EMITIDA' && u.numero === '10'));
  // Os que falharam so "andam" para o fim da fila (mesmo status).
  assert.ok(atualizacoes.some((u) => u.id === 'd2' && u.status === 'PROCESSANDO'));
  assert.ok(atualizacoes.some((u) => u.id === 'd3' && u.status === 'PROCESSANDO'));
});

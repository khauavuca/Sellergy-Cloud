// aplicarStatusCobranca: escrita condicional (sem corrida) e status finais.
// Banco falso em memoria injetado no lugar de ../prisma; ganchos de
// confirmacao trocados por um contador.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const linhas = new Map();
const notificacoes = [];
let efeitos = 0;

function casa(l, where) {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(l[k]);
      if ('not' in v) return l[k] !== v.not;
    }
    return l[k] === v;
  });
}
const tique = () => new Promise((r) => setImmediate(r));

const prismaFalso = {
  cobranca: {
    async updateMany({ where, data }) {
      await tique(); // abre espaco pra outra chamada concorrente
      let count = 0;
      for (const l of linhas.values()) if (casa(l, where)) { Object.assign(l, data); count++; }
      return { count };
    },
    async findUnique({ where }) { const l = linhas.get(where.id); return l ? { ...l } : null; },
  },
  usuario: { findMany: async () => [{ id: 'u1' }] },
  preferenciaNotificacao: { findUnique: async () => null },
  notificacao: { create: async ({ data }) => { notificacoes.push(data); return data; } },
};

function injetar(rel, exports) {
  const caminho = require.resolve(path.join(__dirname, rel));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports };
}
injetar('../prisma', prismaFalso);
injetar('./pagamentoHooks/index.js', { aoConfirmarPagamento: async () => { efeitos++; } });

const { aplicarStatusCobranca, transicaoPermitida } = require('./cobrancaPagamento');

function nova(status = 'PENDENTE') {
  const c = { id: `c${linhas.size + 1}`, clienteId: 't1', origem: 'AVULSA', refId: 'X', valor: 10, status, pagoEm: null };
  linhas.set(c.id, { ...c });
  return c;
}

test('dois webhooks "pago" ao mesmo tempo: a baixa roda uma vez so', async () => {
  efeitos = 0;
  const c = nova();
  const [a, b] = await Promise.all([aplicarStatusCobranca(c, 'PAGO'), aplicarStatusCobranca(c, 'PAGO')]);
  assert.equal(a.status, 'PAGO');
  assert.equal(b.status, 'PAGO');
  assert.equal(efeitos, 1);
  await aplicarStatusCobranca(c, 'PAGO'); // re-entrega
  assert.equal(efeitos, 1);
});

test('PAGO nao volta para EXPIRADO, CANCELADO nem PENDENTE', async () => {
  const c = nova();
  await aplicarStatusCobranca(c, 'PAGO');
  for (const s of ['EXPIRADO', 'CANCELADO', 'PENDENTE']) {
    const r = await aplicarStatusCobranca(c, s);
    assert.equal(r.status, 'PAGO', s);
  }
});

test('ESTORNADO e final: nao volta para PAGO e nao reexecuta a baixa', async () => {
  efeitos = 0;
  notificacoes.length = 0;
  const c = nova();
  await aplicarStatusCobranca(c, 'PAGO');
  assert.equal(efeitos, 1);
  const r = await aplicarStatusCobranca({ ...c, status: 'PAGO' }, 'ESTORNADO');
  assert.equal(r.status, 'ESTORNADO');
  assert.equal(notificacoes.length, 1); // estorno de algo pago avisa o negocio
  assert.match(notificacoes[0].titulo, /estornado/i);
  const r2 = await aplicarStatusCobranca(c, 'PAGO');
  assert.equal(r2.status, 'ESTORNADO');
  assert.equal(efeitos, 1);
});

test('Pix pago depois de vencer ainda confirma (EXPIRADO -> PAGO)', async () => {
  efeitos = 0;
  const c = nova('EXPIRADO');
  const r = await aplicarStatusCobranca(c, 'PAGO', '2026-11-24T10:00:00Z');
  assert.equal(r.status, 'PAGO');
  assert.equal(efeitos, 1);
});

test('estorno de cobranca nao paga nao avisa', async () => {
  notificacoes.length = 0;
  const c = nova();
  const r = await aplicarStatusCobranca(c, 'ESTORNADO');
  assert.equal(r.status, 'ESTORNADO');
  assert.equal(notificacoes.length, 0);
});

test('tabela de transicoes', () => {
  assert.equal(transicaoPermitida('PENDENTE', 'PAGO'), true);
  assert.equal(transicaoPermitida('PAGO', 'ESTORNADO'), true);
  assert.equal(transicaoPermitida('ESTORNADO', 'PAGO'), false);
  assert.equal(transicaoPermitida('PAGO', 'CANCELADO'), false);
  assert.equal(transicaoPermitida('PAGO', 'PAGO'), false);
  assert.equal(transicaoPermitida('EXPIRADO', 'PENDENTE'), true);
});

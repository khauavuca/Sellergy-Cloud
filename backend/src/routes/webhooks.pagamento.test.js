// Rota POST /webhooks/pagamento/:provedor de ponta a ponta, com banco falso em
// memoria, cofre de credenciais trocado por stub e o PSP respondido por um
// fetch falso (nada sai pra rede: o servidor escuta em 127.0.0.1).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const cobrancas = new Map();
let credencial = null;

function casa(l, where) {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(l[k]);
      if ('not' in v) return l[k] !== v.not;
    }
    return l[k] === v;
  });
}

const prismaFalso = {
  cobranca: {
    findFirst: async ({ where }) => { for (const l of cobrancas.values()) if (casa(l, where)) return { ...l }; return null; },
    findUnique: async ({ where }) => (cobrancas.get(where.id) ? { ...cobrancas.get(where.id) } : null),
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const l of cobrancas.values()) if (casa(l, where)) { Object.assign(l, data); count++; }
      return { count };
    },
  },
  configuracaoPagamento: { findUnique: async () => ({ clienteId: 't1', provedor: 'MERCADO_PAGO', credencialId: credencial ? 'cred-1' : null, ativo: true }) },
  usuario: { findMany: async () => [] },
};

function injetar(rel, exports) {
  const caminho = require.resolve(path.join(__dirname, rel));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports };
}
injetar('../prisma', prismaFalso);
injetar('../credenciais', { carregarCredencialDecifrada: async () => credencial });
injetar('../services/pagamentoHooks/index.js', { aoConfirmarPagamento: async () => {} });

const roteador = require('./webhooks.routes');

const fetchOriginal = global.fetch;
let respostaPsp = null; // corpo que o "Mercado Pago" devolve na consulta
let consultas = [];

let base;
let servidor;
test.before(async () => {
  global.fetch = async (url, op) => {
    if (String(url).startsWith('https://api.mercadopago.com')) {
      consultas.push(String(url));
      return { ok: true, status: 200, text: async () => JSON.stringify(respostaPsp) };
    }
    return fetchOriginal(url, op);
  };
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/webhooks', roteador);
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => { global.fetch = fetchOriginal; servidor?.close(); });

function ambiente({ live = false, simulado = false, producao = false } = {}) {
  process.env.PAGAMENTO_LIVE = live ? 'true' : '';
  process.env.PAGAMENTO_WEBHOOK_SIMULADO = simulado ? '1' : '';
  process.env.NODE_ENV = producao ? 'production' : 'test';
}

function cobranca(dados) {
  const c = { clienteId: 't1', origem: 'AVULSA', refId: null, valor: 10, metodo: 'PIX', status: 'PENDENTE', provedor: 'MERCADO_PAGO', pagoEm: null, ...dados };
  cobrancas.set(c.id, c);
  return c;
}

async function postar(caminho, corpo, headers = {}) {
  const r = await fetchOriginal(`${base}${caminho}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json() };
}

test('modo simulado: POST forjado nao marca como pago', async () => {
  ambiente();
  credencial = null;
  cobranca({ id: 'c-sim', provedorCobrancaId: '111' });
  const r = await postar('/webhooks/pagamento/mercado_pago', { type: 'payment', data: { id: '111' } });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ignorado, 'pagamento em modo de teste');
  assert.equal(cobrancas.get('c-sim').status, 'PENDENTE');
});

test('modo simulado em producao: ignora mesmo com PAGAMENTO_WEBHOOK_SIMULADO=1', async () => {
  ambiente({ simulado: true, producao: true });
  cobranca({ id: 'c-prod', provedorCobrancaId: '112' });
  const r = await postar('/webhooks/pagamento/mercado_pago', { type: 'payment', data: { id: '112' } });
  assert.equal(r.corpo.ignorado, 'pagamento em modo de teste');
  assert.equal(cobrancas.get('c-prod').status, 'PENDENTE');
});

test('PAGAMENTO_WEBHOOK_SIMULADO=1 em dev: aplica (teste local do fluxo)', async () => {
  ambiente({ simulado: true });
  cobranca({ id: 'c-dev', provedorCobrancaId: '113' });
  const r = await postar('/webhooks/pagamento/mercado_pago', { type: 'payment', data: { id: '113' } });
  assert.equal(r.corpo.ok, true);
  assert.equal(cobrancas.get('c-dev').status, 'PAGO');
});

test('link do Mercado Pago: casa pela referencia, consulta o payment e passa a guardar o id dele', async () => {
  ambiente({ live: true });
  credencial = { dados: { accessToken: 'tok' } };
  consultas = [];
  respostaPsp = { id: 999, status: 'approved', external_reference: 'c-link', date_approved: '2026-11-24T12:00:00Z' };
  cobranca({ id: 'c-link', metodo: 'LINK', provedorCobrancaId: 'pref-abc' });
  const r = await postar('/webhooks/pagamento/mercado_pago?ref=c-link', { type: 'payment', data: { id: '999' } });
  assert.equal(r.corpo.ok, true);
  assert.equal(cobrancas.get('c-link').status, 'PAGO');
  assert.equal(cobrancas.get('c-link').provedorCobrancaId, '999');
  assert.match(consultas[0], /\/v1\/payments\/999$/); // consultou o PAGAMENTO, nao a preference
});

test('link: referencia forjada (o payment e de outra cobranca) nao aplica', async () => {
  ambiente({ live: true });
  credencial = { dados: { accessToken: 'tok' } };
  respostaPsp = { id: 555, status: 'approved', external_reference: 'outra-cobranca' };
  cobranca({ id: 'c-alvo', metodo: 'LINK', provedorCobrancaId: 'pref-x' });
  const r = await postar('/webhooks/pagamento/mercado_pago?ref=c-alvo', { type: 'payment', data: { id: '555' } });
  assert.equal(r.corpo.ignorado, 'referencia nao confere');
  assert.equal(cobrancas.get('c-alvo').status, 'PENDENTE');
});

test('link: pagamento recusado nao cancela a cobranca do link', async () => {
  ambiente({ live: true });
  credencial = { dados: { accessToken: 'tok' } };
  respostaPsp = { id: 556, status: 'rejected', external_reference: 'c-rej' };
  cobranca({ id: 'c-rej', metodo: 'LINK', provedorCobrancaId: 'pref-r' });
  await postar('/webhooks/pagamento/mercado_pago?ref=c-rej', { type: 'payment', data: { id: '556' } });
  assert.equal(cobrancas.get('c-rej').status, 'PENDENTE');
  assert.equal(cobrancas.get('c-rej').provedorCobrancaId, 'pref-r');
});

test('assinatura do Mercado Pago: confere com o data.id da query; errada = 401', async () => {
  ambiente({ live: true });
  const segredo = 'segredo-webhook';
  credencial = { dados: { accessToken: 'tok', webhookSecret: segredo } };
  respostaPsp = { id: 777, status: 'approved', external_reference: 'c-ass' };
  cobranca({ id: 'c-ass', provedorCobrancaId: '777' });
  const ts = '1700000000';
  const v1 = crypto.createHmac('sha256', segredo).update(`id:777;request-id:req-9;ts:${ts};`).digest('hex');

  const ruim = await postar('/webhooks/pagamento/mercado_pago?data.id=777&type=payment', { type: 'payment', data: { id: '777' } }, { 'x-signature': `ts=${ts},v1=${'0'.repeat(64)}`, 'x-request-id': 'req-9' });
  assert.equal(ruim.status, 401);
  assert.equal(cobrancas.get('c-ass').status, 'PENDENTE');

  const boa = await postar('/webhooks/pagamento/mercado_pago?data.id=777&type=payment', { type: 'payment', data: { id: '777' } }, { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-9' });
  assert.equal(boa.status, 200);
  assert.equal(cobrancas.get('c-ass').status, 'PAGO');
});

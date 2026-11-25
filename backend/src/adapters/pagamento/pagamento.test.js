// Adapters de pagamento: casamento do webhook (link do Mercado Pago/Pagar.me),
// assinatura do Mercado Pago pela query string, status do Asaas e chave de
// idempotencia. Sem rede: modo fixture ou fetch falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const MercadoPago = require('./mercadoPago');
const Pagarme = require('./pagarme');
const Asaas = require('./asaas');
const { STATUS } = require('./ProvedorPagamento');

function assinarMp({ segredo, dataId, requestId, ts }) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return `ts=${ts},v1=${crypto.createHmac('sha256', segredo).update(manifest).digest('hex')}`;
}

test('Mercado Pago: assinatura confere com o data.id da QUERY STRING', () => {
  const mp = new MercadoPago({});
  const segredo = 'segredo-do-webhook';
  const headers = { 'x-signature': assinarMp({ segredo, dataId: '123456', requestId: 'req-1', ts: '1700000000' }), 'x-request-id': 'req-1' };
  assert.equal(mp.verificarAssinatura({ headers, segredo, query: { 'data.id': '123456', type: 'payment' } }), true);
  // sem a query (como era antes) o manifest sai sem id e a assinatura falha
  assert.equal(mp.verificarAssinatura({ headers, segredo, query: {} }), false);
  // id trocado na URL: falha
  assert.equal(mp.verificarAssinatura({ headers, segredo, query: { 'data.id': '999' } }), false);
  // segredo errado: falha
  assert.equal(mp.verificarAssinatura({ headers, segredo: 'outro', query: { 'data.id': '123456' } }), false);
});

test('Mercado Pago: data.id alfanumerico entra em minusculas no manifest', () => {
  const mp = new MercadoPago({});
  const segredo = 's';
  const headers = { 'x-signature': assinarMp({ segredo, dataId: 'abc123', requestId: 'r', ts: '1' }), 'x-request-id': 'r' };
  assert.equal(mp.verificarAssinatura({ headers, segredo, query: { 'data.id': 'ABC123' } }), true);
});

test('Mercado Pago: parse do webhook traz o id do payment e a referencia (?ref=)', () => {
  const mp = new MercadoPago({});
  const p = mp.parsearWebhook({ body: { type: 'payment', action: 'payment.updated', data: { id: 777 } }, query: { ref: 'cob-1' } });
  assert.equal(p.provedorCobrancaId, '777');
  assert.equal(p.pagamentoId, '777');
  assert.equal(p.refExterna, 'cob-1');
  // notificacao so pela query (formato antigo)
  const q = mp.parsearWebhook({ body: {}, query: { type: 'payment', 'data.id': '55' } });
  assert.equal(q.provedorCobrancaId, '55');
  assert.equal(mp.parsearWebhook({ body: { type: 'merchant_order', data: { id: 1 } } }), null);
});

test('Mercado Pago: link manda notification_url com ?ref= e consulta devolve external_reference', async () => {
  const antes = process.env.API_URL_PUBLICA;
  process.env.API_URL_PUBLICA = 'https://api.exemplo.com/';
  try {
    const mp = new MercadoPago({});
    let corpo;
    mp._executar = async (req, fixture) => { corpo = req.corpo; return fixture(); };
    const link = await mp.criarLink({ valor: 10, descricao: 'x', refExterna: 'cob-9' });
    assert.equal(corpo.notification_url, 'https://api.exemplo.com/webhooks/pagamento/mercado_pago?ref=cob-9');
    assert.equal(corpo.external_reference, 'cob-9');
    assert.match(link.provedorCobrancaId, /pref/);
  } finally {
    if (antes === undefined) delete process.env.API_URL_PUBLICA; else process.env.API_URL_PUBLICA = antes;
  }
  const r = await new MercadoPago({}).consultarStatus('777', { refExterna: 'cob-9' });
  assert.equal(r.status, STATUS.PAGO);
  assert.equal(r.refExterna, 'cob-9');
});

test('Pagar.me: webhook de charge do link traz o code do pedido como referencia', () => {
  const pg = new Pagarme({});
  const p = pg.parsearWebhook({ body: { type: 'charge.paid', data: { id: 'ch_1', status: 'paid', order: { id: 'or_1', code: 'cob-2' } } } });
  assert.equal(p.provedorCobrancaId, 'ch_1');
  assert.equal(p.pagamentoId, 'ch_1');
  assert.equal(p.refExterna, 'cob-2');
  assert.equal(p.status, STATUS.PAGO);
  // order.paid: consulta pela 1a charge do pedido
  const o = pg.parsearWebhook({ body: { type: 'order.paid', data: { id: 'or_1', code: 'cob-2', charges: [{ id: 'ch_9' }] } } });
  assert.equal(o.provedorCobrancaId, 'or_1');
  assert.equal(o.pagamentoId, 'ch_9');
  assert.equal(o.refExterna, 'cob-2');
});

test('Pagar.me: POST de pedido e de link leva Idempotency-Key; consulta devolve o code', async () => {
  const pg = new Pagarme({ credencial: { dados: { secretKey: 'sk_test' } } });
  const headers = [];
  pg._executar = async (req, fixture) => { headers.push(req.headers); return fixture(); };
  await pg.criarCobrancaPix({ valor: 5, descricao: 'x', refExterna: 'cob-3' });
  await pg.criarLink({ valor: 5, descricao: 'x', refExterna: 'cob-3' });
  assert.equal(headers[0]['Idempotency-Key'], 'pix-cob-3');
  assert.equal(headers[1]['Idempotency-Key'], 'link-cob-3');
  const r = await new Pagarme({}).consultarStatus('ch_1', { refExterna: 'cob-3' });
  assert.equal(r.refExterna, 'cob-3');
});

test('ProvedorPagamento: a chave de idempotencia chega no fetch e libera a retentativa do POST', async () => {
  const pg = new Pagarme({ credencial: { dados: { secretKey: 'sk_test' } }, modo: 'live' });
  const chamadas = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, op) => {
    chamadas.push(op.headers);
    if (chamadas.length === 1) return { ok: false, status: 502, text: async () => '' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'or_1', status: 'pending', charges: [{ id: 'ch_1', status: 'pending', last_transaction: {} }] }) };
  };
  try {
    const r = await pg.criarCobrancaPix({ valor: 5, descricao: 'x', refExterna: 'cob-4' });
    assert.equal(r.provedorCobrancaId, 'ch_1');
    assert.equal(chamadas.length, 2); // 502 com chave -> repetiu
    assert.equal(chamadas[0]['Idempotency-Key'], 'pix-cob-4');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Asaas: POST de cobranca sem chave de idempotencia NAO repete em 502', async () => {
  const a = new Asaas({ credencial: { dados: { apiKey: 'k' } }, modo: 'live' });
  let chamadas = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => { chamadas++; return { ok: false, status: 502, text: async () => '{}' }; };
  try {
    await assert.rejects(() => a.criarLink({ valor: 5, descricao: 'x', refExterna: 'c', pagador: { clienteExternoId: 'cus_1' } }), /HTTP 502/);
    assert.equal(chamadas, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Asaas: status de estorno, chargeback e negativacao', () => {
  const n = Asaas.normalizarStatus;
  assert.equal(n('RECEIVED'), STATUS.PAGO);
  assert.equal(n('REFUND_REQUESTED'), STATUS.PAGO); // estorno pedido: dinheiro ainda la
  assert.equal(n('REFUND_IN_PROGRESS'), STATUS.PAGO);
  assert.equal(n('REFUNDED'), STATUS.ESTORNADO);
  assert.equal(n('CHARGEBACK_REQUESTED'), STATUS.ESTORNADO);
  assert.equal(n('CHARGEBACK_DISPUTE'), STATUS.ESTORNADO);
  assert.equal(n('AWAITING_CHARGEBACK_REVERSAL'), STATUS.ESTORNADO);
  assert.equal(n('DUNNING_REQUESTED'), STATUS.EXPIRADO);
  assert.equal(n('DUNNING_RECEIVED'), STATUS.PAGO);
  assert.equal(n('OVERDUE'), STATUS.EXPIRADO);
  assert.equal(Asaas.statusDoEvento('PAYMENT_CHARGEBACK_REQUESTED'), STATUS.ESTORNADO);
  assert.equal(Asaas.statusDoEvento('PAYMENT_DUNNING_RECEIVED'), STATUS.PAGO);
});

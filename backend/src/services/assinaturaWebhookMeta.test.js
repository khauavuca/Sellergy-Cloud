const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { assinaturaValida, conferirWebhookMeta } = require('./assinaturaWebhookMeta');

const SEGREDO = 'segredo-do-app';
const corpo = Buffer.from(JSON.stringify({ entry: [{ changes: [] }] }));
const assinar = (buf, segredo = SEGREDO) => `sha256=${crypto.createHmac('sha256', segredo).update(buf).digest('hex')}`;

test('assinatura certa do corpo cru passa', () => {
  assert.equal(assinaturaValida({ corpoCru: corpo, cabecalho: assinar(corpo), segredo: SEGREDO }), true);
});

test('assinatura com outro segredo, corpo alterado, formato ruim ou ausente e recusada', () => {
  assert.equal(assinaturaValida({ corpoCru: corpo, cabecalho: assinar(corpo, 'outro'), segredo: SEGREDO }), false);
  assert.equal(assinaturaValida({ corpoCru: Buffer.from('{"x":1}'), cabecalho: assinar(corpo), segredo: SEGREDO }), false);
  assert.equal(assinaturaValida({ corpoCru: corpo, cabecalho: 'sha256=abc', segredo: SEGREDO }), false);
  assert.equal(assinaturaValida({ corpoCru: corpo, cabecalho: 'sha1=' + 'a'.repeat(40), segredo: SEGREDO }), false);
  assert.equal(assinaturaValida({ corpoCru: corpo, cabecalho: undefined, segredo: SEGREDO }), false);
  assert.equal(assinaturaValida({ corpoCru: undefined, cabecalho: assinar(corpo), segredo: SEGREDO }), false);
});

test('com segredo configurado: valida em qualquer ambiente', () => {
  const env = { WHATSAPP_APP_SECRET: SEGREDO, NODE_ENV: 'development', WHATSAPP_WEBHOOK_SEM_ASSINATURA: '1' };
  assert.deepEqual(conferirWebhookMeta({ corpoCru: corpo, cabecalho: assinar(corpo), env }), { ok: true, modo: 'ASSINADO' });
  // A chave de dev NAO libera POST sem assinatura quando o segredo existe.
  const r = conferirWebhookMeta({ corpoCru: corpo, cabecalho: undefined, env });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test('sem segredo em producao: recusa sempre, mesmo com a chave de dev', () => {
  const r = conferirWebhookMeta({ corpoCru: corpo, cabecalho: undefined, env: { NODE_ENV: 'production', WHATSAPP_WEBHOOK_SEM_ASSINATURA: '1' } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'SEGREDO_NAO_CONFIGURADO');
});

test('sem segredo em dev: so aceita com WHATSAPP_WEBHOOK_SEM_ASSINATURA=1', () => {
  assert.equal(conferirWebhookMeta({ corpoCru: corpo, env: { NODE_ENV: 'development' } }).ok, false);
  assert.deepEqual(
    conferirWebhookMeta({ corpoCru: corpo, env: { NODE_ENV: 'development', WHATSAPP_WEBHOOK_SEM_ASSINATURA: '1' } }),
    { ok: true, modo: 'SEM_ASSINATURA_DEV' },
  );
});

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { assinaturaValida, conferirWebhookMeta, conferirWebhookMetaPorNumero } = require('./assinaturaWebhookMeta');

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

test('por numero: cada numero confere com o segredo do proprio cliente', () => {
  const segredosPorNumero = new Map([['PN_A', 'segredo-a'], ['PN_B', 'segredo-b']]);
  // Cliente A assina com o segredo dele: passa so o numero dele, nunca o de B.
  const r = conferirWebhookMetaPorNumero({ corpoCru: corpo, cabecalho: assinar(corpo, 'segredo-a'), segredosPorNumero, env: { NODE_ENV: 'production' } });
  assert.deepEqual([...r.aceitos], ['PN_A']);
  assert.deepEqual(r.recusados, ['PN_B']);
});

test('por numero: cliente sem segredo usa o de reserva; sem nenhum, so passa em dev com a chave', () => {
  const segredosPorNumero = new Map([['PN_A', null]]);
  const comReserva = conferirWebhookMetaPorNumero({ corpoCru: corpo, cabecalho: assinar(corpo), segredosPorNumero, env: { WHATSAPP_APP_SECRET: SEGREDO, NODE_ENV: 'production' } });
  assert.deepEqual([...comReserva.aceitos], ['PN_A']);
  const prod = conferirWebhookMetaPorNumero({ corpoCru: corpo, cabecalho: undefined, segredosPorNumero, env: { NODE_ENV: 'production', WHATSAPP_WEBHOOK_SEM_ASSINATURA: '1' } });
  assert.equal(prod.aceitos.size, 0);
  assert.deepEqual(prod.semSegredo, ['PN_A']);
  const dev = conferirWebhookMetaPorNumero({ corpoCru: corpo, cabecalho: undefined, segredosPorNumero, env: { NODE_ENV: 'development', WHATSAPP_WEBHOOK_SEM_ASSINATURA: '1' } });
  assert.deepEqual([...dev.aceitos], ['PN_A']);
  assert.equal(dev.modo, 'SEM_ASSINATURA_DEV');
});

test('por numero: o segredo do cliente vale mesmo com reserva diferente configurada', () => {
  const segredosPorNumero = new Map([['PN_A', 'segredo-a']]);
  const r = conferirWebhookMetaPorNumero({ corpoCru: corpo, cabecalho: assinar(corpo, SEGREDO), segredosPorNumero, env: { WHATSAPP_APP_SECRET: SEGREDO } });
  assert.equal(r.aceitos.size, 0);
});

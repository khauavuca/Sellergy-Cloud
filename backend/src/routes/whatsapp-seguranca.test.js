// Testes de rota (HTTP de verdade em 127.0.0.1, porta aleatoria) pros furos
// de seguranca do WhatsApp: webhook da Meta sem assinatura e sequestro de
// numero pelo PATCH /bots/:id/canal. Prisma, auth e filas sao falsos.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const prisma = require('../prisma');

// ---- stubs de modulo (antes de carregar as rotas) ----
function stubModulo(relativo, exportsFalsos) {
  const caminho = require.resolve(path.join(__dirname, relativo));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: exportsFalsos };
}
let usuarioAtual = { id: 'u1', perfil: 'DONO', clienteId: 'c1' };
stubModulo('../middlewares/auth.middleware', (req, _res, next) => { req.usuario = usuarioAtual; next(); });
const passa = () => (_req, _res, next) => next();
stubModulo('../middlewares/permissoes.middleware', {
  ehAdmin: (u) => u?.perfil === 'ADMIN',
  requerAdmin: (_req, _res, next) => next(),
  requerModuloLiberado: passa,
  requerPermissao: passa,
});
stubModulo('../filas', { enfileirarComandoBaileys: async () => {} });

const credenciais = require('../credenciais');
credenciais.carregarCredencialDecifrada = async () => ({ dados: { accessToken: 'tok' } });
const adapters = require('../adapters/whatsapp');
const enviados = [];
adapters.criarProvedorWhatsapp = () => ({ enviarTexto: async (m) => { enviados.push(m); return { ok: true }; } });

const rotasBots = require('./bots.routes');
const rotasWebhookWhatsapp = require('./webhooksWhatsapp.routes');

const eventos = [];
const ioFalso = {
  salas: [],
  to(s) { this.salas.push(s); return this; },
  emit(evento, dados) { eventos.push({ evento, dados, salas: this.salas }); this.salas = []; },
};

let base;
let servidor;
test.before(async () => {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use((req, _res, next) => { req.io = ioFalso; next(); });
  app.use('/bots', rotasBots);
  app.use('/webhooks', rotasWebhookWhatsapp);
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor?.close());

// ---------------- webhook da Meta ----------------

const SEGREDO = 'segredo-app-teste';
const corpoMeta = (texto) => JSON.stringify({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: 'PNID1' }, messages: [{ from: '5511988887777', text: { body: texto } }] } }] }],
});
const assinar = (corpo) => `sha256=${crypto.createHmac('sha256', SEGREDO).update(corpo).digest('hex')}`;
const postarWebhook = (corpo, cabecalhos = {}) => fetch(`${base}/webhooks/whatsapp`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...cabecalhos }, body: corpo,
});

test('webhook: POST sem assinatura ou com assinatura errada e recusado', async () => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO;
  let consultouBot = false;
  prisma.bot.findFirst = async () => { consultouBot = true; return null; };
  const corpo = corpoMeta('oi');
  assert.equal((await postarWebhook(corpo)).status, 401);
  assert.equal((await postarWebhook(corpo, { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` })).status, 401);
  // Corpo trocado depois de assinado.
  assert.equal((await postarWebhook(corpoMeta('outro'), { 'x-hub-signature-256': assinar(corpo) })).status, 401);
  assert.equal(consultouBot, false);
});

test('webhook: sem segredo em producao recusa; em dev so com a chave explicita', async () => {
  delete process.env.WHATSAPP_APP_SECRET;
  const nodeEnv = process.env.NODE_ENV;
  prisma.bot.findFirst = async () => null;
  try {
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_WEBHOOK_SEM_ASSINATURA = '1';
    assert.equal((await postarWebhook(corpoMeta('oi'))).status, 503);
    process.env.NODE_ENV = 'development';
    delete process.env.WHATSAPP_WEBHOOK_SEM_ASSINATURA;
    assert.equal((await postarWebhook(corpoMeta('oi'))).status, 503);
    process.env.WHATSAPP_WEBHOOK_SEM_ASSINATURA = '1';
    assert.equal((await postarWebhook(corpoMeta('oi'))).status, 200);
  } finally {
    process.env.NODE_ENV = nodeEnv;
    delete process.env.WHATSAPP_WEBHOOK_SEM_ASSINATURA;
  }
});

test('webhook: GET de verificacao (hub.challenge) continua funcionando', async () => {
  prisma.bot.findFirst = async ({ where }) => (where.verifyTokenCanal === 'vt-ok' ? { id: 'b1' } : null);
  const ok = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=vt-ok&hub.challenge=123`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '123');
  const ruim = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`);
  assert.equal(ruim.status, 403);
});

test('webhook assinado: "SAIR" no canal oficial grava opt-out e nao chama o bot', async () => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO;
  const optOuts = [];
  let faqConsultada = false;
  prisma.bot.findFirst = async () => ({ id: 'b1', clienteId: 'c1', status: 'ONLINE', iaAtiva: false, credencialCanalId: 'cr1', provedorCanal: 'META_CLOUD' });
  prisma.faq.findMany = async () => { faqConsultada = true; return []; };
  prisma.optOutWhatsapp.upsert = async ({ create }) => { optOuts.push(create); return create; };
  prisma.bot.update = async () => ({});
  enviados.length = 0;
  const corpo = corpoMeta('SAIR');
  const r = await postarWebhook(corpo, { 'x-hub-signature-256': assinar(corpo) });
  assert.equal(r.status, 200);
  await new Promise((ok) => setTimeout(ok, 50)); // processamento e depois do ack
  assert.deepEqual(optOuts, [{ clienteId: 'c1', telefone: '5511988887777' }]);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].texto, /não vai mais receber/);
  assert.equal(faqConsultada, true); // FAQ carregada 1x por lote, mas o bot nao respondeu
  delete process.env.WHATSAPP_APP_SECRET;
});

// ---------------- PATCH /bots/:id/canal ----------------

const patchCanal = (corpo) => fetch(`${base}/bots/b1/canal`, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});

test('canal: numero ja usado por OUTRO cliente -> 409 e nada e gravado', async () => {
  usuarioAtual = { id: 'u1', perfil: 'DONO', clienteId: 'c1' };
  let gravou = false;
  prisma.bot.findFirst = async ({ where }) => {
    if (where.id === 'b1') return { id: 'b1', clienteId: 'c1' };
    if (where.identificadorCanal === 'PNID-DA-VITIMA') return { id: 'b9', clienteId: 'c9' };
    return null;
  };
  prisma.bot.update = async () => { gravou = true; return {}; };
  const r = await patchCanal({ identificadorCanal: ' PNID-DA-VITIMA ' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).erro, /outra conta/);
  assert.equal(gravou, false);
});

test('canal: corrida que o indice unico pega (P2002) tambem vira 409', async () => {
  prisma.bot.findFirst = async ({ where }) => (where.id === 'b1' ? { id: 'b1', clienteId: 'c1' } : null);
  prisma.bot.update = async () => { throw Object.assign(new Error('Unique constraint'), { code: 'P2002' }); };
  const r = await patchCanal({ identificadorCanal: 'PNID-NOVO' });
  assert.equal(r.status, 409);
});

test('canal: numero livre grava; vazio vira null', async () => {
  const gravados = [];
  prisma.bot.findFirst = async ({ where }) => (where.id === 'b1' ? { id: 'b1', clienteId: 'c1' } : null);
  prisma.bot.update = async ({ data }) => { gravados.push(data); return { id: 'b1', ...data }; };
  assert.equal((await patchCanal({ identificadorCanal: 'PNID-MEU' })).status, 200);
  assert.equal((await patchCanal({ identificadorCanal: '   ' })).status, 200);
  assert.deepEqual(gravados.map((d) => d.identificadorCanal), ['PNID-MEU', null]);
});

// ---------------- eventos de socket ----------------

test('PATCH /status emite so pra sala do negocio, sem QR/verify token/prompt', async () => {
  eventos.length = 0;
  prisma.bot.findFirst = async () => ({ id: 'b1' });
  prisma.bot.update = async () => ({
    id: 'b1', clienteId: 'c1', status: 'ONLINE', qrCodeAtual: 'data:QR', verifyTokenCanal: 'vt', iaPromptSistema: 'segredo',
  });
  const r = await fetch(`${base}/bots/b1/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'ONLINE' }) });
  assert.equal(r.status, 200);
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0].salas, ['cliente:c1', 'admins']);
  assert.equal(eventos[0].dados.qrCodeAtual, undefined);
  assert.equal(eventos[0].dados.verifyTokenCanal, undefined);
  assert.equal(eventos[0].dados.iaPromptSistema, undefined);
});

test('PUT: dono nao aumenta a propria cota de IA (so admin)', async () => {
  usuarioAtual = { id: 'u1', perfil: 'DONO', clienteId: 'c1' };
  const gravados = [];
  prisma.bot.findFirst = async () => ({ id: 'b1' });
  prisma.bot.update = async ({ data }) => { gravados.push(data); return { id: 'b1', clienteId: 'c1' }; };
  const put = (corpo) => fetch(`${base}/bots/b1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  assert.equal((await put({ iaTokensIncluidosMes: 999_999_999, iaExcedenteAutorizadoTokens: 5_000_000 })).status, 200);
  assert.equal(gravados[0].iaTokensIncluidosMes, undefined);
  assert.equal(gravados[0].iaExcedenteAutorizadoTokens, undefined);
  usuarioAtual = { id: 'a1', perfil: 'ADMIN' };
  assert.equal((await put({ iaExcedenteAutorizadoTokens: 1_000_000, iaPrecoPorMilTokensExcedenteCentavos: 1.5 })).status, 200);
  assert.equal(gravados[1].iaExcedenteAutorizadoTokens, 1_000_000);
  assert.equal(gravados[1].iaPrecoPorMilTokensExcedenteCentavos, 1.5);
});

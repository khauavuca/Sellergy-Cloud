// Testes de rota (HTTP de verdade em 127.0.0.1, porta aleatoria) pros furos
// de seguranca do WhatsApp: webhook da Meta sem assinatura e sequestro de
// numero pelo PATCH /bots/:id/canal. Prisma, auth e filas sao falsos.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
// Os testes do oficial cifram o token de verdade: sem a chave no ambiente
// (rodando fora do Docker), usa uma chave so de teste.
process.env.MENSAGENS_MASTER_KEY = process.env.MENSAGENS_MASTER_KEY || crypto.randomBytes(32).toString('base64');
// Teste nunca fala com a Meta, mesmo se o ambiente estiver com o envio real ligado.
delete process.env.WHATSAPP_ENVIO_REAL;
const prisma = require('../prisma');
// Caixa de entrada fora deste teste (sem gravar no banco de dev).
Object.assign(require('../conversas/servico'), { registrarSeguro: async () => null, pausaDoContato: async () => false });

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
let credAtual = { dados: { accessToken: 'tok' } };
credenciais.carregarCredencialDecifrada = async () => credAtual;
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

test('webhook: numero que nao e de nenhum bot recebe 200 e nada e processado', async () => {
  let consultouBot = false;
  prisma.bot.findFirst = async () => { consultouBot = true; return null; };
  prisma.bot.findMany = async () => [];
  assert.equal((await postarWebhook(corpoMeta('oi'))).status, 200);
  await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(consultouBot, false);
});

test('webhook: POST sem assinatura ou com assinatura errada e recusado', async () => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO;
  let consultouBot = false;
  prisma.bot.findFirst = async () => { consultouBot = true; return null; };
  prisma.bot.findMany = async () => [{ identificadorCanal: 'PNID1', clienteId: 'c1', credencialCanalId: 'cr1' }];
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
  prisma.bot.update = async () => ({});
  prisma.bot.findMany = async () => [{ identificadorCanal: 'PNID1', clienteId: 'c1', credencialCanalId: 'cr1' }];
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
  const confirmados = [];
  prisma.bot.update = async ({ where, data }) => { confirmados.push({ id: where.id, data }); return {}; };
  const ok = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=vt-ok&hub.challenge=123`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '123');
  const ruim = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`);
  assert.equal(ruim.status, 403);
  // So o verify token certo marca o webhook como confirmado.
  assert.equal(confirmados.length, 1);
  assert.ok(confirmados[0].data.webhookConfirmadoEm instanceof Date);
});

test('webhook assinado: "SAIR" no canal oficial grava opt-out e nao chama o bot', async () => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO;
  const optOuts = [];
  let faqConsultada = false;
  prisma.bot.findFirst = async () => ({ id: 'b1', clienteId: 'c1', status: 'ONLINE', iaAtiva: false, credencialCanalId: 'cr1', provedorCanal: 'META_CLOUD' });
  prisma.bot.findMany = async () => [{ identificadorCanal: 'PNID1', clienteId: 'c1', credencialCanalId: 'cr1' }];
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

test('webhook: numero com segredo proprio do cliente so passa assinado com ELE', async () => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO; // reserva de outro app: nao vale pra este cliente
  credAtual = { dados: { accessToken: 'tok', appSecret: 'segredo-do-cliente' } };
  let processou = 0;
  prisma.bot.findMany = async () => [{ identificadorCanal: 'PNID1', clienteId: 'c1', credencialCanalId: 'cr1' }];
  prisma.bot.findFirst = async () => { processou += 1; return null; };
  try {
    const corpo = corpoMeta('oi');
    assert.equal((await postarWebhook(corpo, { 'x-hub-signature-256': assinar(corpo) })).status, 401);
    const certo = `sha256=${crypto.createHmac('sha256', 'segredo-do-cliente').update(corpo).digest('hex')}`;
    assert.equal((await postarWebhook(corpo, { 'x-hub-signature-256': certo })).status, 200);
    await new Promise((ok) => setTimeout(ok, 30));
    assert.equal(processou, 1);
  } finally {
    credAtual = { dados: { accessToken: 'tok' } };
    delete process.env.WHATSAPP_APP_SECRET;
  }
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

test('PUT: dono nao liga a IA nem troca o modelo; ajusta so prompt e acoes', async () => {
  usuarioAtual = { id: 'u1', perfil: 'DONO', clienteId: 'c1' };
  const gravados = [];
  prisma.bot.findFirst = async () => ({ id: 'b1' });
  prisma.bot.update = async ({ data }) => { gravados.push(data); return { id: 'b1', clienteId: 'c1' }; };
  const put = (corpo) => fetch(`${base}/bots/b1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  assert.equal((await put({ iaAtiva: true, iaModelo: 'deepseek-v4-pro', iaPromptSistema: '  Seja breve.  ' })).status, 200);
  assert.equal(gravados[0].iaAtiva, undefined);
  assert.equal(gravados[0].iaModelo, undefined);
  assert.equal(gravados[0].iaPromptSistema, 'Seja breve.');
  usuarioAtual = { id: 'a1', perfil: 'ADMIN' };
  assert.equal((await put({ iaAtiva: true, iaModelo: 'deepseek-v4-pro' })).status, 200);
  assert.equal(gravados[1].iaAtiva, true);
  assert.equal(gravados[1].iaModelo, 'deepseek-v4-pro');
});

test('GET /bots: admin filtra por ?clienteId; dono fica no proprio negocio', async () => {
  const filtros = [];
  prisma.bot.findMany = async ({ where }) => { filtros.push(where); return []; };
  usuarioAtual = { id: 'a1', perfil: 'ADMIN' };
  await fetch(`${base}/bots?clienteId=c9`);
  assert.deepEqual(filtros[0], { clienteId: 'c9' });
  usuarioAtual = { id: 'u1', perfil: 'DONO', clienteId: 'c1' };
  await fetch(`${base}/bots?clienteId=c9`);
  assert.deepEqual(filtros[1], { clienteId: 'c1' });
});

// ---------------- PUT /bots/:id/canal/oficial (app do proprio cliente) ----------------

const TOKEN_META = `EAAG${'t'.repeat(100)}`;
const SEGREDO_APP = 'f'.repeat(32);
const putOficial = (corpo) => fetch(`${base}/bots/b1/canal/oficial`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});

function stubOficial({ bot, credExistente = null, numeroEmUso = null }) {
  const gravado = { cred: null, bot: null };
  prisma.bot.findFirst = async ({ where }) => {
    if (where.identificadorCanal) return numeroEmUso;
    if (where.clienteId && where.clienteId !== bot.clienteId) return null;
    return bot;
  };
  prisma.credencial.findFirst = async () => (credExistente ? { id: credExistente.id } : null);
  credAtual = credExistente ? { dados: credExistente.dados } : { dados: { accessToken: 'tok' } };
  prisma.$transaction = async (fn) => fn({
    credencial: {
      update: async ({ where, data }) => { gravado.cred = { modo: 'update', id: where.id, data }; return { id: where.id }; },
      create: async ({ data }) => { gravado.cred = { modo: 'create', data }; return { id: 'cr-novo' }; },
    },
    bot: { update: async ({ data }) => { gravado.bot = data; return { id: bot.id, ...data }; } },
  });
  return gravado;
}

test('oficial: primeira vez sem o segredo do app explica o que falta', async () => {
  usuarioAtual = { id: 'u1', perfil: 'DONO', clienteId: 'c1' };
  stubOficial({ bot: { id: 'b1', clienteId: 'c1', credencialCanalId: null, identificadorCanal: null, verifyTokenCanal: null } });
  const r = await putOficial({ identificadorCanal: '1290672074119010', accessToken: TOKEN_META });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.campo, 'appSecret');
  assert.match(j.erro, /segredo do app/);
});

test('oficial: com os 3 dados cria a credencial, liga o oficial e gera o verify token', async () => {
  usuarioAtual = { id: 'u1', perfil: 'DONO', clienteId: 'c1' };
  const g = stubOficial({ bot: { id: 'b1', clienteId: 'c1', credencialCanalId: null, identificadorCanal: null, verifyTokenCanal: null } });
  const r = await putOficial({ identificadorCanal: ' 1290672074119010 ', accessToken: TOKEN_META, appSecret: SEGREDO_APP });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.conferidoNaMeta, false); // envio real desligado nos testes
  assert.equal(g.cred.modo, 'create');
  assert.equal(g.cred.data.tipo, 'WHATSAPP_CLOUD_TOKEN');
  assert.equal(g.cred.data.clienteId, 'c1');
  assert.ok(!JSON.stringify(g.cred.data).includes(TOKEN_META), 'token nunca vai em claro pro banco');
  assert.equal(g.bot.provedorCanal, 'META_CLOUD');
  assert.equal(g.bot.credencialCanalId, 'cr-novo');
  assert.equal(g.bot.identificadorCanal, '1290672074119010');
  assert.match(g.bot.verifyTokenCanal, /^sellergy-/);
  assert.equal(g.bot.webhookConfirmadoEm, null);
});

test('oficial: so trocando o numero mantem token e segredo e o verify token', async () => {
  usuarioAtual = { id: 'u1', perfil: 'DONO', clienteId: 'c1' };
  const g = stubOficial({
    bot: { id: 'b1', clienteId: 'c1', credencialCanalId: 'cr1', identificadorCanal: '1290672074119010', verifyTokenCanal: 'vt-antigo' },
    credExistente: { id: 'cr1', dados: { accessToken: TOKEN_META, appSecret: SEGREDO_APP } },
  });
  const r = await putOficial({ identificadorCanal: '1290672074119011' });
  assert.equal(r.status, 200);
  assert.equal(g.cred.modo, 'update');
  assert.equal(g.cred.id, 'cr1');
  assert.equal(g.bot.verifyTokenCanal, 'vt-antigo');
  assert.equal(g.bot.webhookConfirmadoEm, null); // numero mudou: espera a Meta confirmar de novo
});

test('oficial: numero de outra conta da 409 e nada e gravado; bot de outro negocio da 404', async () => {
  usuarioAtual = { id: 'u1', perfil: 'DONO', clienteId: 'c1' };
  const g = stubOficial({
    bot: { id: 'b1', clienteId: 'c1', credencialCanalId: null, identificadorCanal: null, verifyTokenCanal: null },
    numeroEmUso: { clienteId: 'c2' },
  });
  const r = await putOficial({ identificadorCanal: '1290672074119010', accessToken: TOKEN_META, appSecret: SEGREDO_APP });
  assert.equal(r.status, 409);
  assert.equal(g.cred, null);
  assert.equal(g.bot, null);

  usuarioAtual = { id: 'u9', perfil: 'DONO', clienteId: 'c9' };
  stubOficial({ bot: { id: 'b1', clienteId: 'c1', credencialCanalId: null, identificadorCanal: null, verifyTokenCanal: null } });
  assert.equal((await putOficial({ identificadorCanal: '1290672074119010', accessToken: TOKEN_META, appSecret: SEGREDO_APP })).status, 404);
});

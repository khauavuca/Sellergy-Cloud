// IA da plataforma: regras puras + rotas /admin/plataforma/ia (provedor,
// modelo, lista do OpenRouter e teste), sem rede e sem banco.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');
const prisma = require('../prisma');

function stubModulo(relativo, exportsFalsos) {
  const caminho = require.resolve(path.join(__dirname, relativo));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: exportsFalsos };
}
stubModulo('../middlewares/auth.middleware', (req, _res, next) => { req.usuario = { id: 'a1', perfil: 'ADMIN' }; next(); });
stubModulo('../middlewares/permissoes.middleware', { requerAdmin: (_req, _res, next) => next(), ehAdmin: () => true });

const credenciais = require('../credenciais');
let cofre = null; // dados decifrados da DEEPSEEK_KEY
const salvos = [];
credenciais.carregarCredencialPlataforma = async () => (cofre ? { id: 'cp1', tipo: 'DEEPSEEK_KEY', dados: cofre } : null);
credenciais.salvarCredencialPlataforma = async (p) => { salvos.push(p); cofre = p.payload; return { id: 'cp1' }; };

const ia = require('./iaPlataforma');
const DeepSeekAdapter = require('../adapters/ia/deepseek');
const rotas = require('../routes/admin-credencial-ia.routes');

let base; let servidor;
const fetchOriginal = global.fetch;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/admin/plataforma', rotas);
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}/admin/plataforma`;
  prisma.credencial.findFirst = async () => (cofre ? { atualizadoEm: new Date('2026-11-26T12:00:00Z'), criadoEm: new Date(), ultimoUsoEm: null } : null);
});
test.after(() => { servidor?.close(); global.fetch = fetchOriginal; });

// Chamadas pra fora (OpenRouter/DeepSeek) passam por aqui; as do teste pro servidor local seguem normal.
let respostaExterna = null;
const chamadasExternas = [];
global.fetch = async (url, opcoes) => {
  if (String(url).startsWith('http://127.0.0.1')) return fetchOriginal(url, opcoes);
  chamadasExternas.push({ url: String(url), opcoes });
  return respostaExterna(String(url), opcoes);
};
const json = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const chamar = (metodo, rota, corpo) => fetch(base + rota, {
  method: metodo, headers: { 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ s: r.status, j: await r.json() }));

test('validarConfigIA: DeepSeek ignora modelo, OpenRouter exige um modelo valido', () => {
  assert.deepEqual(ia.validarConfigIA({}), { provedor: 'DEEPSEEK', modelo: null });
  assert.deepEqual(ia.validarConfigIA({ provedor: 'deepseek', modelo: 'x' }), { provedor: 'DEEPSEEK', modelo: null });
  assert.ok(ia.validarConfigIA({ provedor: 'OPENROUTER' }).erro);
  assert.ok(ia.validarConfigIA({ provedor: 'OPENROUTER', modelo: 'a b' }).erro);
  assert.ok(ia.validarConfigIA({ provedor: 'GEMINI' }).erro);
  assert.deepEqual(ia.validarConfigIA({ provedor: 'OPENROUTER', modelo: 'google/gemma-4-31b-it:free' }), { provedor: 'OPENROUTER', modelo: 'google/gemma-4-31b-it:free' });
});

test('chave antiga (so apiKey) continua DeepSeek', () => {
  assert.deepEqual(ia.configDaCredencial({ apiKey: 'sk' }), { provedor: 'DEEPSEEK', modelo: null });
  assert.deepEqual(ia.configDaCredencial(null), { provedor: 'DEEPSEEK', modelo: null });
});

test('lista do OpenRouter: so com tools, gratis primeiro, depois os mais baratos', () => {
  const lista = ia.filtrarModelosOpenRouter([
    { id: 'a/caro', name: 'Caro', supported_parameters: ['tools'], pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'b/sem-tools:free', name: 'Sem tools', supported_parameters: [], pricing: { prompt: '0', completion: '0' } },
    { id: 'c/barato', name: 'Barato', supported_parameters: ['tools'], pricing: { prompt: '0.0000001', completion: '0.0000004' } },
    { id: 'd/gratis:free', name: 'Gratis', supported_parameters: ['tools', 'temperature'], pricing: { prompt: '0', completion: '0' }, context_length: 128000 },
    { id: 'lixo com espaco', supported_parameters: ['tools'] },
  ]);
  assert.deepEqual(lista.map((m) => m.id), ['d/gratis:free', 'c/barato', 'a/caro']);
  assert.equal(lista[0].gratis, true);
  assert.equal(lista[2].entrada, 3);
  assert.equal(lista[2].saida, 15);
  assert.equal(lista[0].contexto, 128000);
});

test('adapter: credencial do OpenRouter muda endereco, modelo e cabecalhos', async () => {
  respostaExterna = () => json(200, { model: 'google/gemma-4-31b-it:free', choices: [{ message: { content: 'Oi!' } }], usage: { total_tokens: 9 } });
  chamadasExternas.length = 0;
  const a = new DeepSeekAdapter({ credencial: { dados: { apiKey: 'sk-or-x', provedor: 'OPENROUTER', modelo: 'google/gemma-4-31b-it:free' } }, modo: 'live' });
  const r = await a.responder({ mensagens: [{ role: 'user', content: 'oi' }], modelo: 'deepseek-v4-pro' });
  assert.equal(r.texto, 'Oi!');
  const c = chamadasExternas[0];
  assert.equal(c.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(JSON.parse(c.opcoes.body).model, 'google/gemma-4-31b-it:free');
  assert.equal(c.opcoes.headers.Authorization, 'Bearer sk-or-x');
  assert.equal(c.opcoes.headers['X-Title'], 'Sellergy Cloud');
});

test('adapter: chave da DeepSeek segue no endereco e modelo de sempre', async () => {
  respostaExterna = () => json(200, { choices: [{ message: { content: 'ok' } }] });
  chamadasExternas.length = 0;
  const a = new DeepSeekAdapter({ credencial: { dados: { apiKey: 'sk-ds' } }, modo: 'live' });
  await a.responder({ mensagens: [{ role: 'user', content: 'oi' }], modelo: 'deepseek-v4-pro' });
  assert.equal(chamadasExternas[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(JSON.parse(chamadasExternas[0].opcoes.body).model, 'deepseek-v4-pro');
  assert.equal(chamadasExternas[0].opcoes.headers['X-Title'], undefined);
});

test('rotas: salvar OpenRouter, trocar so o modelo sem colar a chave, trocar de provedor exige chave', async () => {
  cofre = null;
  let r = await chamar('GET', '/ia');
  assert.equal(r.j.configurada, false);

  r = await chamar('PUT', '/ia', { provedor: 'OPENROUTER', modelo: 'google/gemma-4-31b-it:free' });
  assert.equal(r.s, 400, 'sem chave nenhuma salva, precisa colar');

  r = await chamar('PUT', '/ia', { provedor: 'OPENROUTER', modelo: 'google/gemma-4-31b-it:free', apiKey: ' sk-or-1 ' });
  assert.equal(r.s, 200);
  assert.deepEqual(cofre, { apiKey: 'sk-or-1', provedor: 'OPENROUTER', modelo: 'google/gemma-4-31b-it:free' });
  assert.equal(salvos.at(-1).nome, 'OpenRouter (plataforma)');

  r = await chamar('PUT', '/ia', { provedor: 'OPENROUTER', modelo: 'nvidia/nemotron-3.5-super-vl:free' });
  assert.equal(r.s, 200);
  assert.equal(cofre.apiKey, 'sk-or-1', 'mantem a chave');
  assert.equal(cofre.modelo, 'nvidia/nemotron-3.5-super-vl:free');

  r = await chamar('PUT', '/ia', { provedor: 'DEEPSEEK' });
  assert.equal(r.s, 400);
  assert.match(r.j.erro, /DeepSeek/);

  r = await chamar('GET', '/ia');
  assert.equal(r.j.configurada, true);
  assert.equal(r.j.provedor, 'OPENROUTER');
  assert.equal(r.j.modelo, 'nvidia/nemotron-3.5-super-vl:free');
  assert.equal(JSON.stringify(r.j).includes('sk-or-1'), false, 'chave nunca volta');
});

test('rotas: testar devolve a resposta ou o erro legivel do provedor', async () => {
  cofre = { apiKey: 'sk-or-1', provedor: 'OPENROUTER', modelo: 'google/gemma-4-31b-it:free' };
  respostaExterna = () => json(200, { model: 'google/gemma-4-31b-it:free', choices: [{ message: { content: 'Estamos sim!' } }], usage: { total_tokens: 30 } });
  let r = await chamar('POST', '/ia/testar');
  assert.equal(r.j.ok, true);
  assert.equal(r.j.texto, 'Estamos sim!');
  assert.equal(r.j.tokens, 30);

  respostaExterna = () => json(401, { error: { message: 'No auth credentials found', code: 401 } });
  r = await chamar('POST', '/ia/testar');
  assert.equal(r.j.ok, false);
  assert.equal(r.j.erro, 'No auth credentials found');

  cofre = null;
  r = await chamar('POST', '/ia/testar');
  assert.equal(r.s, 400);
});

test('rotas: lista de modelos vem filtrada e fica em cache', async () => {
  ia._limparCache();
  chamadasExternas.length = 0;
  respostaExterna = () => json(200, { data: [{ id: 'x/y:free', name: 'XY', supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' } }] });
  let r = await chamar('GET', '/ia/modelos');
  assert.deepEqual(r.j.map((m) => m.id), ['x/y:free']);
  r = await chamar('GET', '/ia/modelos');
  assert.equal(chamadasExternas.length, 1, 'segunda vez veio do cache');

  ia._limparCache();
  respostaExterna = () => json(503, {});
  r = await chamar('GET', '/ia/modelos');
  assert.equal(r.s, 502);
});

const test = require('node:test');
const assert = require('node:assert');
const DeepSeekAdapter = require('./deepseek');
const { normalizarResposta } = DeepSeekAdapter;

function criarAdapter() {
  return new DeepSeekAdapter({ credencial: { dados: { apiKey: 'sk-teste' } }, modo: 'fixture' });
}

test('modo fixture nao bate na rede e devolve resposta normalizada com tokens', async () => {
  const adapter = criarAdapter();
  const r = await adapter.responder({ mensagens: [{ role: 'user', content: 'oi' }] });
  assert.strictEqual(typeof r.texto, 'string');
  assert.ok(r.texto.length > 0);
  assert.strictEqual(r.tokensTotal, r.tokensPrompt + r.tokensCompletion);
  assert.ok(r.tokensTotal > 0);
});

test('mensagens vazio lanca erro tratavel (400, nao derruba o processo)', async () => {
  const adapter = criarAdapter();
  await assert.rejects(
    () => adapter.responder({ mensagens: [] }),
    (erro) => erro.codigo === 'IA_SEM_MENSAGENS' && erro.status === 400,
  );
});

test('modelo invalido cai pro modelo padrao em vez de quebrar', async () => {
  const adapter = criarAdapter();
  const r = await adapter.responder({ mensagens: [{ role: 'user', content: 'oi' }], modelo: 'gpt-4o-mini' });
  assert.strictEqual(r.bruto.model, 'deepseek-v4-flash');
});

test('modelo valido (pro) e respeitado', async () => {
  const adapter = criarAdapter();
  const r = await adapter.responder({ mensagens: [{ role: 'user', content: 'oi' }], modelo: 'deepseek-v4-pro' });
  assert.strictEqual(r.bruto.model, 'deepseek-v4-pro');
});

// --- normalizarResposta: parsing do tool calling (formato OpenAI) ---

test('normalizarResposta extrai tool_calls e faz parse dos argumentos', () => {
  const raw = {
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'consultar_estoque', arguments: '{"produto":"camiseta azul"}' },
        }],
      },
    }],
    usage: { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 },
  };
  const r = normalizarResposta(raw);
  assert.strictEqual(r.toolCalls.length, 1);
  assert.strictEqual(r.toolCalls[0].id, 'call_1');
  assert.strictEqual(r.toolCalls[0].nome, 'consultar_estoque');
  assert.deepStrictEqual(r.toolCalls[0].argumentos, { produto: 'camiseta azul' });
  assert.strictEqual(r.tokensTotal, 220);
});

test('normalizarResposta sem tool_calls devolve array vazio (resposta de texto normal)', () => {
  const raw = { choices: [{ message: { role: 'assistant', content: 'Oi! Como posso ajudar?' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
  const r = normalizarResposta(raw);
  assert.strictEqual(r.toolCalls.length, 0);
  assert.strictEqual(r.texto, 'Oi! Como posso ajudar?');
});

test('normalizarResposta com argumentos malformados nao lanca — trata como vazio', () => {
  const raw = {
    choices: [{ message: { tool_calls: [{ id: 'call_2', function: { name: 'x', arguments: '{invalido' } }] } }],
    usage: {},
  };
  const r = normalizarResposta(raw);
  assert.deepStrictEqual(r.toolCalls[0].argumentos, {});
});

// --- nome do modelo configuravel (IA_MODELO_PADRAO) ---

test('resolverModelo: aceita os dois nomes do flash e o pro', () => {
  const { resolverModelo, MODELOS_VALIDOS } = DeepSeekAdapter;
  assert.ok(MODELOS_VALIDOS.has('deepseek-flash'));
  assert.ok(MODELOS_VALIDOS.has('deepseek-v4-flash'));
  assert.equal(resolverModelo('deepseek-flash', {}), 'deepseek-flash');
  assert.equal(resolverModelo('deepseek-v4-flash', {}), 'deepseek-v4-flash');
  assert.equal(resolverModelo('deepseek-v4-pro', {}), 'deepseek-v4-pro');
  assert.equal(resolverModelo(undefined, {}), 'deepseek-v4-flash');
});

test('IA_MODELO_PADRAO troca o nome real do flash (e do invalido), sem mexer no pro', () => {
  const { resolverModelo } = DeepSeekAdapter;
  const env = { IA_MODELO_PADRAO: 'deepseek-flash' };
  assert.equal(resolverModelo('deepseek-v4-flash', env), 'deepseek-flash');
  assert.equal(resolverModelo('gpt-4o', env), 'deepseek-flash');
  assert.equal(resolverModelo('deepseek-v4-pro', env), 'deepseek-v4-pro');
  // Valor estranho na env e ignorado (cai no fixo).
  assert.equal(resolverModelo('deepseek-v4-flash', { IA_MODELO_PADRAO: 'rm -rf /' }), 'deepseek-v4-flash');
});

test('adapter manda o nome resolvido pela env', async () => {
  process.env.IA_MODELO_PADRAO = 'deepseek-flash';
  try {
    const r = await criarAdapter().responder({ mensagens: [{ role: 'user', content: 'oi' }], modelo: 'deepseek-v4-flash' });
    assert.strictEqual(r.bruto.model, 'deepseek-flash');
  } finally {
    delete process.env.IA_MODELO_PADRAO;
  }
});

test('OpenRouter: IA_BASE_URL troca o endereco (so https) e IA_MODELO_FORCADO manda no modelo', () => {
  const { baseUrl, modeloForcado, resolverModelo } = DeepSeekAdapter;
  assert.equal(baseUrl({}), 'https://api.deepseek.com');
  assert.equal(baseUrl({ IA_BASE_URL: 'https://openrouter.ai/api/v1/' }), 'https://openrouter.ai/api/v1');
  assert.equal(baseUrl({ IA_BASE_URL: 'http://openrouter.ai/api/v1' }), 'https://api.deepseek.com');
  assert.equal(baseUrl({ IA_BASE_URL: 'javascript:alert(1)' }), 'https://api.deepseek.com');
  const env = { IA_MODELO_FORCADO: 'deepseek/deepseek-v4-flash-0731:free' };
  assert.equal(modeloForcado(env), 'deepseek/deepseek-v4-flash-0731:free');
  assert.equal(modeloForcado({ IA_MODELO_FORCADO: 'x y' }), null);
  assert.equal(resolverModelo('deepseek-v4-pro', env), 'deepseek/deepseek-v4-flash-0731:free');
  assert.equal(resolverModelo('deepseek-v4-pro', {}), 'deepseek-v4-pro');
});

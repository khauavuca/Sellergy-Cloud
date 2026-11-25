const test = require('node:test');
const assert = require('node:assert');
const { fetchComRetentativa } = require('./httpSeguro');

// fetch falso: cada chamada consome a proxima entrada da fila. Cada entrada e
// { status } (resposta HTTP) ou { erro } (fetch rejeita, ex.: rede fora).
function fetchFalsoDaFila(fila) {
  let chamadas = 0;
  const chamado = () => chamadas;
  const fn = async () => {
    chamadas++;
    const proximo = fila.shift();
    if (!proximo) throw new Error('fila de respostas vazia — teste mal configurado');
    if (proximo.erro) throw proximo.erro;
    return { ok: proximo.status >= 200 && proximo.status < 300, status: proximo.status };
  };
  return { fn, chamado };
}

test('sucesso de primeira: nao tenta de novo', async () => {
  const { fn, chamado } = fetchFalsoDaFila([{ status: 200 }]);
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const resp = await fetchComRetentativa('http://x', {}, { tentativas: 3 });
    assert.strictEqual(resp.ok, true);
    assert.strictEqual(chamado(), 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('429 na primeira tentativa, 200 na segunda — retenta e devolve sucesso', async () => {
  const { fn, chamado } = fetchFalsoDaFila([{ status: 429 }, { status: 200 }]);
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const resp = await fetchComRetentativa('http://x', {}, { tentativas: 3 });
    assert.strictEqual(resp.ok, true);
    assert.strictEqual(chamado(), 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('400 (erro do cliente, nao do provedor) nao retenta — devolve na hora', async () => {
  const { fn, chamado } = fetchFalsoDaFila([{ status: 400 }]);
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const resp = await fetchComRetentativa('http://x', {}, { tentativas: 3 });
    assert.strictEqual(resp.ok, false);
    assert.strictEqual(resp.status, 400);
    assert.strictEqual(chamado(), 1); // nao gastou as outras 2 tentativas a toa
  } finally {
    global.fetch = originalFetch;
  }
});

test('500 persistente esgota as tentativas e devolve a ultima resposta (nao lanca)', async () => {
  const { fn, chamado } = fetchFalsoDaFila([{ status: 500 }, { status: 500 }, { status: 500 }]);
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const resp = await fetchComRetentativa('http://x', {}, { tentativas: 3 });
    assert.strictEqual(resp.ok, false);
    assert.strictEqual(resp.status, 500);
    assert.strictEqual(chamado(), 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('excecao de rede esgota as tentativas e propaga o erro', async () => {
  const erroDeRede = new Error('ECONNRESET');
  const { fn, chamado } = fetchFalsoDaFila([{ erro: erroDeRede }, { erro: erroDeRede }]);
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    await assert.rejects(
      () => fetchComRetentativa('http://x', {}, { tentativas: 2 }),
      /ECONNRESET/,
    );
    assert.strictEqual(chamado(), 2);
  } finally {
    global.fetch = originalFetch;
  }
});

// --- Metodo nao idempotente (POST) — nao duplica cobranca/nota/saque ---

async function comFetch(fila, fn) {
  const falso = fetchFalsoDaFila(fila);
  const originalFetch = global.fetch;
  global.fetch = falso.fn;
  try {
    return await fn(falso.chamado);
  } finally {
    global.fetch = originalFetch;
  }
}

test('POST sem chave de idempotencia: 502 volta na primeira (nao repete)', async () => {
  await comFetch([{ status: 502 }, { status: 200 }], async (chamado) => {
    const resp = await fetchComRetentativa('http://x', { method: 'POST' }, { tentativas: 3 });
    assert.strictEqual(resp.status, 502);
    assert.strictEqual(chamado(), 1);
  });
});

test('POST sem chave: erro de rede/timeout propaga na primeira', async () => {
  await comFetch([{ erro: new Error('ECONNRESET') }, { status: 200 }], async (chamado) => {
    await assert.rejects(() => fetchComRetentativa('http://x', { method: 'post' }, { tentativas: 3 }), /ECONNRESET/);
    assert.strictEqual(chamado(), 1);
  });
});

test('POST sem chave: 429 repete (o provedor recusou sem processar)', async () => {
  await comFetch([{ status: 429 }, { status: 201 }], async (chamado) => {
    const resp = await fetchComRetentativa('http://x', { method: 'POST' }, { tentativas: 3 });
    assert.strictEqual(resp.status, 201);
    assert.strictEqual(chamado(), 2);
  });
});

test('POST com Idempotency-Key (qualquer caixa) repete em 5xx', async () => {
  await comFetch([{ status: 503 }, { status: 200 }], async (chamado) => {
    const resp = await fetchComRetentativa('http://x', { method: 'POST', headers: { 'Idempotency-Key': 'cob-1' } }, { tentativas: 3 });
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(chamado(), 2);
  });
  await comFetch([{ status: 500 }, { status: 200 }], async (chamado) => {
    await fetchComRetentativa('http://x', { method: 'POST', headers: { 'x-idempotency-key': 'pix-1' } }, { tentativas: 3 });
    assert.strictEqual(chamado(), 2);
  });
});

test('repetirNaoIdempotente: true forca a retentativa do POST', async () => {
  await comFetch([{ status: 500 }, { status: 200 }], async (chamado) => {
    await fetchComRetentativa('http://x', { method: 'POST' }, { tentativas: 2, repetirNaoIdempotente: true });
    assert.strictEqual(chamado(), 2);
  });
});

test('podeRepetir: GET/PUT/DELETE sim, POST/PATCH so com chave', () => {
  const { podeRepetir } = require('./httpSeguro');
  assert.strictEqual(podeRepetir({}), true);
  assert.strictEqual(podeRepetir({ method: 'DELETE' }), true);
  assert.strictEqual(podeRepetir({ method: 'PATCH' }), false);
  assert.strictEqual(podeRepetir({ method: 'POST', headers: { 'Idempotency-Key': '' } }), false);
  assert.strictEqual(podeRepetir({ method: 'POST', headers: new Headers({ 'Idempotency-Key': 'a' }) }), true);
});

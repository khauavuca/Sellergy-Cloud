const test = require('node:test');
const assert = require('node:assert');
const { comTrava, msAteProximaHora, PREFIXO } = require('./travaRotina');

// Redis falso: SET NX PX + os dois scripts Lua (liberar / renovar se o token bate).
function redisFalso() {
  const chaves = new Map();
  return {
    chaves,
    async set(chave, valor, px, ttl, nx) {
      assert.strictEqual(px, 'PX');
      assert.strictEqual(nx, 'NX');
      if (chaves.has(chave)) return null;
      chaves.set(chave, { valor, ttl: Number(ttl) });
      return 'OK';
    },
    async eval(script, _n, chave, token, ms) {
      const atual = chaves.get(chave);
      if (!atual || atual.valor !== token) return 0;
      if (script.includes("'del'")) { chaves.delete(chave); return 1; }
      atual.ttl = Number(ms);
      return 1;
    },
  };
}

test('so uma instancia roda: a segunda encontra a trava ocupada', async () => {
  const redis = redisFalso();
  let rodadas = 0;
  let liberar;
  const lenta = comTrava('fiscal', () => new Promise((r) => { rodadas += 1; liberar = r; }), { redis, ttlMs: 60_000 });
  await new Promise((r) => setImmediate(r));
  const segunda = await comTrava('fiscal', async () => { rodadas += 1; }, { redis, ttlMs: 60_000 });
  assert.deepStrictEqual(segunda, { rodou: false, motivo: 'OCUPADA' });
  liberar('feito');
  const primeira = await lenta;
  assert.deepStrictEqual(primeira, { rodou: true, resultado: 'feito' });
  assert.strictEqual(rodadas, 1);
  // Sem janela minima: libera no fim e a proxima rodada pode entrar.
  assert.strictEqual(redis.chaves.size, 0);
  assert.strictEqual((await comTrava('fiscal', async () => 2, { redis })).rodou, true);
});

test('janela minima: segura a chave pelo resto do intervalo (1 rodada por janela)', async () => {
  const redis = redisFalso();
  let t = 1000;
  await comTrava('pacotes', async () => { t += 10_000; }, { redis, ttlMs: 60_000, manterPorMs: 50_000, agora: () => t });
  const chave = redis.chaves.get(`${PREFIXO}pacotes`);
  assert.ok(chave, 'chave continua presa');
  assert.strictEqual(chave.ttl, 40_000);
  assert.strictEqual((await comTrava('pacotes', async () => 1, { redis })).motivo, 'OCUPADA');
});

test('erro da rotina sobe, mas a trava e liberada', async () => {
  const redis = redisFalso();
  await assert.rejects(() => comTrava('pedidos', async () => { throw new Error('falhou'); }, { redis }), /falhou/);
  assert.strictEqual(redis.chaves.size, 0);
});

test('Redis fora do ar: pula a rodada sem derrubar nada', async () => {
  const redis = { set: async () => { throw new Error('ECONNREFUSED'); }, eval: async () => 0 };
  let rodou = false;
  const r = await comTrava('assinaturas', async () => { rodou = true; }, { redis });
  assert.deepStrictEqual(r, { rodou: false, motivo: 'REDIS_INDISPONIVEL' });
  assert.strictEqual(rodou, false);
});

test('rotina diaria: ms ate a proxima hora cheia', () => {
  const antes = new Date(2026, 10, 24, 8, 30, 0);
  assert.strictEqual(msAteProximaHora(9, antes), 30 * 60_000);
  const depois = new Date(2026, 10, 24, 10, 0, 0);
  assert.strictEqual(msAteProximaHora(9, depois), 23 * 3600_000);
});

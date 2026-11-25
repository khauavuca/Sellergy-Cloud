// Cache de URLs assinadas: limite de tamanho, validade e respeito ao expiraEm.
// Assinar uma URL e conta local (nao bate no MinIO).
const test = require('node:test');
const assert = require('node:assert');

process.env.STORAGE_CACHE_URLS_MAX = '3';
const { urlAssinada, _cacheUrls } = require('./minio');

const { cacheUrlsAssinadas, lerCacheUrl, gravarCacheUrl, varrerCacheUrls } = _cacheUrls;

test('cache nao passa do limite: sai a entrada mais antiga', () => {
  cacheUrlsAssinadas.clear();
  const agora = Date.now();
  for (const k of ['a', 'b', 'c', 'd']) gravarCacheUrl(`${k}|86400`, `url-${k}`, 86400, agora);
  assert.strictEqual(cacheUrlsAssinadas.size, 3);
  assert.strictEqual(lerCacheUrl('a|86400', 86400, agora), null);
  assert.strictEqual(lerCacheUrl('d|86400', 86400, agora), 'url-d');
});

test('so reusa com pelo menos metade da vida pedida; vencida sai do cache', () => {
  cacheUrlsAssinadas.clear();
  const t0 = 1_000_000_000;
  gravarCacheUrl('x|3600', 'url-x', 3600, t0);
  assert.strictEqual(lerCacheUrl('x|3600', 3600, t0 + 20 * 60_000), 'url-x');
  // Restam 25 min de 60: abaixo da metade -> regera (e tira do cache).
  assert.strictEqual(lerCacheUrl('x|3600', 3600, t0 + 35 * 60_000), null);
  assert.strictEqual(cacheUrlsAssinadas.has('x|3600'), false);
  gravarCacheUrl('y|3600', 'url-y', 3600, t0);
  varrerCacheUrls(t0 + 3600_000);
  assert.strictEqual(cacheUrlsAssinadas.size, 0);
  // URL curta (5 min) nem entra no cache.
  gravarCacheUrl('z|300', 'url-z', 300, t0);
  assert.strictEqual(cacheUrlsAssinadas.size, 0);
});

test('urlAssinada respeita o expiraEm pedido (1 h nao recebe a URL de 24 h)', async () => {
  cacheUrlsAssinadas.clear();
  const longa = await urlAssinada('produtos/c1/foto.jpg');
  const curta = await urlAssinada('produtos/c1/foto.jpg', { expiraEm: 3600 });
  assert.match(longa, /X-Amz-Expires=86400/);
  assert.match(curta, /X-Amz-Expires=3600/);
  assert.strictEqual(await urlAssinada('produtos/c1/foto.jpg', { expiraEm: 3600 }), curta);
});

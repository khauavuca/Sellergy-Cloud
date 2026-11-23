// Service worker minimo do Sellergy (PWA "Hoje no celular").
// So guarda arquivos que NUNCA mudam de conteudo: os de /assets com hash no
// nome (gerados pelo build do Vite) e os icones. Nao toca em HTML, navegacao,
// chamadas da API (outro dominio) nem em nada que nao seja GET: tudo isso vai
// direto pra rede, entao dado de venda/caixa nunca fica velho no celular.

const CACHE = 'sellergy-estaticos-v1';
const COM_HASH = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|svg|jpg|jpeg|webp)$/;
const ICONES = /^\/icones\/[a-z0-9-]+\.png$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n.startsWith('sellergy-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET' || req.mode === 'navigate') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!COM_HASH.test(url.pathname) && !ICONES.test(url.pathname)) return;

  evento.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(req);
    if (guardado) return guardado;
    const resp = await fetch(req);
    if (resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
    return resp;
  })());
});

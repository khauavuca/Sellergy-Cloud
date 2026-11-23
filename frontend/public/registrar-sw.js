// Registra o service worker (sw.js) SO no build de producao. Arquivo separado
// (e nao inline no index.html) por causa da CSP de producao (script-src 'self').
// O index.html passa o modo do Vite em data-modo (%MODE% e trocado no build).
(function () {
  try {
    var script = document.currentScript;
    var modo = script && script.getAttribute('data-modo');
    if (modo !== 'production' || !('serviceWorker' in navigator)) return;
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (location.protocol !== 'https:' && !local) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
    });
  } catch (e) { /* sem service worker: o app funciona igual */ }
})();

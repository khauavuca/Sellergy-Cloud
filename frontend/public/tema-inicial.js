// Anti-flash: aplica o tema salvo antes do React carregar.
// Fica num arquivo (e não inline no index.html) pra a Content-Security-Policy
// de produção poder proibir script inline (script-src 'self').
(function () {
  try {
    var stored = localStorage.getItem('sellergy-ui-storage');
    var parsed = stored ? JSON.parse(stored) : null;
    var theme = (parsed && parsed.state && parsed.state.theme) || 'light';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.style.backgroundColor = '#0A0A0A';
    } else {
      document.documentElement.style.backgroundColor = '#FAFAF7';
    }
  } catch (e) {
    document.documentElement.style.backgroundColor = '#FAFAF7';
  }
})();

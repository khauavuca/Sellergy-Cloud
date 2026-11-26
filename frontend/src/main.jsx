import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Depois de uma atualizacao do site, quem estava com a pagina aberta pede um
// pedaco de codigo que nao existe mais (404) e a tela ficava branca. Aqui a
// pagina recarrega sozinha UMA vez (guarda na sessao pra nao entrar em loop).
const CHAVE_RECARGA = 'sellergy:recarregou-versao';
function recarregarVersaoNova() {
  try {
    const ultima = Number(sessionStorage.getItem(CHAVE_RECARGA) || 0);
    if (Date.now() - ultima < 60_000) return false;
    sessionStorage.setItem(CHAVE_RECARGA, String(Date.now()));
  } catch { /* sem sessionStorage: recarrega mesmo assim */ }
  window.location.reload();
  return true;
}
window.addEventListener('vite:preloadError', (ev) => {
  if (recarregarVersaoNova()) ev.preventDefault();
});
window.addEventListener('unhandledrejection', (ev) => {
  const msg = String(ev?.reason?.message || ev?.reason || '');
  if (/dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(msg)) {
    recarregarVersaoNova();
  }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Escolha da pessoa sobre cookies, guardada no proprio navegador.
//   'todos'       -> aceitou tudo (inclui medicao/marketing, se um dia existir)
//   'essenciais'  -> so o necessario pro site funcionar
// Qualquer script opcional futuro (analytics, pixel) so pode carregar se
// cookiesOpcionaisPermitidos() for true.

const CHAVE = 'sellergy:cookies';
const VERSAO = 1; // aumente se as categorias mudarem: pergunta de novo
const EVENTO = 'sellergy:cookies-abrir';

export function lerConsentimento() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    return salvo && salvo.versao === VERSAO ? salvo : null;
  } catch {
    return null;
  }
}

export function salvarConsentimento(escolha) {
  const registro = { escolha, versao: VERSAO, em: new Date().toISOString() };
  try { localStorage.setItem(CHAVE, JSON.stringify(registro)); } catch { /* modo privado: vale so nesta visita */ }
  return registro;
}

export function cookiesOpcionaisPermitidos() {
  return lerConsentimento()?.escolha === 'todos';
}

/** Reabre o aviso (link "preferências de cookies"). */
export function abrirPreferenciasCookies() {
  window.dispatchEvent(new Event(EVENTO));
}

export const EVENTO_ABRIR_COOKIES = EVENTO;

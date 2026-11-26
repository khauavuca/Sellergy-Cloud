import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3333',
  // A sessao viaja num cookie httpOnly emitido pela API. Como o front roda em
  // outro dominio, sem `withCredentials` o navegador nao anexa esse cookie e
  // toda requisicao autenticada volta 401.
  withCredentials: true,
});

// Segredo de CSRF entregue pela API no corpo de /login e /perfil.
// Fica SO em memoria de proposito: gravar em localStorage recriaria exatamente o
// problema que o cookie httpOnly resolveu (dado de sessao legivel por um XSS).
// A cada recarga da pagina o valor volta pelo /perfil.
let csrfEmMemoria = null;

export function definirCsrf(valor) {
  csrfEmMemoria = valor || null;
}

// Limpeza unica do token que versoes anteriores guardavam no navegador. Sem
// isso, a credencial antiga continuaria exposta ao JavaScript ate o usuario
// limpar os dados do site na mao.
try {
  localStorage.removeItem('@sellergy:token');
} catch { /* navegador com storage bloqueado: nada a fazer */ }

api.interceptors.request.use((config) => {
  // O cabecalho prova que a requisicao partiu do nosso front: um site atacante
  // consegue fazer o navegador enviar o cookie, mas nao consegue ler este valor.
  if (csrfEmMemoria) {
    config.headers['X-CSRF-Token'] = csrfEmMemoria;
  }
  // Pula a pagina de aviso do ngrok-free: sem isso, ao chamar a API pelo tunel,
  // o ngrok devolve HTML (a interstitial) no lugar do JSON. Inofensivo fora do ngrok.
  config.headers['ngrok-skip-browser-warning'] = 'true';
  return config;
});

// Admin sem o codigo em 2 etapas, com ADMIN_2FA_OBRIGATORIO ligado: a API
// barra tudo (403) menos perfil/configurar/ativar. Leva direto pra tela de
// configurar o codigo, com o aviso ligado pela query string.
export const ROTA_CONFIGURAR_2FA = '/admin/configuracoes/perfil';

api.interceptors.response.use(
  (resposta) => resposta,
  (erro) => {
    // Parte da API responde { error } e parte { erro }; as telas leem `erro`.
    // Normaliza aqui pra mensagem certa sempre aparecer (o servidor tambem manda os dois).
    const dados = erro?.response?.data;
    if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
      if (dados.erro == null && typeof dados.error === 'string') dados.erro = dados.error;
      if (dados.error == null && typeof dados.erro === 'string') dados.error = dados.erro;
    }
    if (erro?.response?.status === 403 && erro.response.data?.codigo === 'ADMIN_2FA_OBRIGATORIO') {
      if (typeof window !== 'undefined' && window.location.pathname !== ROTA_CONFIGURAR_2FA) {
        window.location.assign(`${ROTA_CONFIGURAR_2FA}?aviso=2fa`);
      }
    }
    return Promise.reject(erro);
  },
);

// URL publica do backend para colar em servicos externos (Meta, MP, etc).
// Em dev, vem do tunel ngrok; em prod, do dominio publico real.
// Fallback para a baseURL da API quando nao definida.
export function urlPublica() {
  const publica = import.meta.env.VITE_URL_PUBLICA;
  const base = publica || api.defaults.baseURL || '';
  return base.replace(/\/$/, '');
}

export default api;

import { create } from 'zustand';
import api, { definirCsrf } from '../services/api';

// A sessao vive num cookie httpOnly gerenciado pela API. O front nao guarda (nem
// consegue ler) o token — quem responde "estou logado?" e sempre o servidor,
// via /perfil. Por isso nao ha mais campo `token` nem nada em localStorage.
export const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  isCheckingAuth: true,
  error: null,

  // Desafio do codigo em 2 etapas: a senha conferiu e a API pediu o codigo do
  // app autenticador. Vale 5 minutos (no servidor); so fica em memoria.
  desafio2fa: null,

  // Guarda a sessao que a API devolveu (login, 2FA, cadastro, ativar 2FA) e
  // reforca o estado com /perfil (modulosLiberados, branding, mfa etc.).
  entrarComSessao: async ({ usuario, csrfToken }) => {
    // O cookie de sessao ja veio na resposta; aqui so guardamos o segredo de
    // CSRF que acompanha as proximas requisicoes de escrita.
    definirCsrf(csrfToken);
    set({ user: usuario, isAuthenticated: true, isLoading: false, desafio2fa: null, error: null });
    try {
      const perfil = await api.get('/autenticacao/perfil');
      definirCsrf(perfil.data?.csrfToken);
      set({ user: perfil.data });
    } catch { /* ignora, ja temos o user da resposta */ }
  },

  // Devolve 'ok', 'precisa2fa' ou false (erro em `error`).
  login: async (email, senha) => {
    set({ isLoading: true, error: null, desafio2fa: null });
    try {
      const response = await api.post('/autenticacao/login', { email, senha });
      if (response.data?.precisa2fa) {
        set({ desafio2fa: response.data.desafio, isLoading: false });
        return 'precisa2fa';
      }
      await get().entrarComSessao(response.data);
      return 'ok';
    } catch (error) {
      set({
        error: error.response?.data?.erro || 'Erro ao fazer login. Verifique suas credenciais.',
        isLoading: false
      });
      return false;
    }
  },

  // Segunda etapa: codigo de 6 digitos do app autenticador.
  confirmar2fa: async (codigo) => {
    const desafio = get().desafio2fa;
    if (!desafio) {
      set({ error: 'O tempo para digitar o código acabou. Entre com e-mail e senha de novo.' });
      return false;
    }
    set({ isLoading: true, error: null });
    try {
      const response = await api.post('/autenticacao/login/2fa', { desafio, codigo });
      await get().entrarComSessao(response.data);
      return true;
    } catch (error) {
      const status = error.response?.status;
      const erroApi = error.response?.data?.erro;
      // Desafio vencido (5 min) ou invalido: volta para a etapa da senha.
      const expirou = status === 401 && /desafio|tempo/i.test(erroApi || '');
      set({
        isLoading: false,
        desafio2fa: expirou ? null : desafio,
        error: expirou
          ? 'O tempo para digitar o código acabou. Entre com e-mail e senha de novo.'
          : erroApi || 'Código incorreto. Confira o app autenticador e tente de novo.',
      });
      return false;
    }
  },

  // "Voltar" da etapa do codigo.
  cancelar2fa: () => set({ desafio2fa: null, error: null }),

  // Cadastro proprio (teste gratis): a API cria o negocio + o dono e ja
  // devolve a sessao, igual ao login. Devolve { ok, erro, campos }.
  cadastrar: async (dados) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post('/autenticacao/cadastro', dados);
      await get().entrarComSessao(response.data);
      return { ok: true };
    } catch (error) {
      const erro = error.response?.data?.erro || 'Não foi possível criar a conta agora. Tente de novo.';
      set({ isLoading: false });
      return { ok: false, erro, campos: error.response?.data?.campos || [] };
    }
  },

  // Precisa passar pelo servidor: o cookie e httpOnly, o front nao tem como
  // apaga-lo sozinho.
  //
  // A limpeza local vem ANTES da chamada de rede de proposito. Quem chama
  // navega para a tela de login logo em seguida (ver UserMenu); se o estado so
  // zerasse na volta da requisicao, a tela de login ainda veria a sessao ativa e
  // devolveria o usuario para dentro do sistema.
  logout: async () => {
    definirCsrf(null);
    set({ user: null, isAuthenticated: false, desafio2fa: null });
    try {
      await api.post('/autenticacao/logout');
    } catch { /* rede fora ou sessao ja expirada: o estado local ja foi limpo */ }
  },

  checkAuth: async () => {
    try {
      const response = await api.get('/autenticacao/perfil');
      definirCsrf(response.data?.csrfToken);
      set({ user: response.data, isAuthenticated: true, isCheckingAuth: false });
    } catch {
      definirCsrf(null);
      set({ user: null, isAuthenticated: false, isCheckingAuth: false });
    }
  },

  // Re-busca perfil do servidor (apos trocar senha, mudar permissoes, etc.)
  refreshUser: async () => {
    try {
      const response = await api.get('/autenticacao/perfil');
      definirCsrf(response.data?.csrfToken);
      set({ user: response.data });
      return response.data;
    } catch (error) {
      console.error('Erro ao atualizar perfil:', error);
      return null;
    }
  },

  // Mark password change as done locally (otimistic update apos endpoint sucesso).
  marcarSenhaTrocada: () => {
    const user = get().user;
    if (user) set({ user: { ...user, deveTrocarSenha: false } });
  },
}));

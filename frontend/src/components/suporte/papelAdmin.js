// Papel da pessoa da equipe Sellergy no painel admin (frente D da fase 2).
// A API devolve em /autenticacao/perfil: papelAdmin (DONO | SUPORTE |
// FINANCEIRO) e acoesAdmin (lista do que o papel pode, ex. 'cobranca.baixa').
// A tela so esconde o que nao pode; quem barra de verdade e a API.
// Componentes de estado (SemPermissao, ErroCarregar, Carregando) em EstadosAdmin.jsx.
import api, { definirCsrf } from '../../services/api';
import { useAuthStore } from '../../store/auth.store';

export const NOME_PAPEL = { DONO: 'Dono', SUPORTE: 'Suporte', FINANCEIRO: 'Financeiro', DESATIVADO: 'Desativado' };

export function usePapelAdmin() {
  const user = useAuthStore((s) => s.user);
  const acoes = Array.isArray(user?.acoesAdmin) ? user.acoesAdmin : [];
  return {
    papel: user?.papelAdmin || null,
    pode: (acao) => acoes.includes(acao),
  };
}

/** Mensagem padrao de erro da API (inclusive 403 de papel). */
export function erroDaApi(e, padrao) {
  return e?.response?.data?.erro || padrao;
}

export function dataHora(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Usado pelo painel admin: abre a sessao de suporte e vai pro sistema do cliente. */
export async function entrarComoSuporte({ clienteId, chamadoId, motivo }) {
  try {
    const r = await api.post('/admin/suporte/sessao', { clienteId, chamadoId, motivo: motivo || undefined });
    definirCsrf(r.data.csrfToken);
    window.location.assign(r.data.redirecionar || '/app/dashboard');
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.response?.data?.erro || 'Não foi possível abrir a sessão de suporte.' };
  }
}

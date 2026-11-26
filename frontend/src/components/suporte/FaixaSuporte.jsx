// Faixa no topo quando alguem da Sellergy esta vendo a conta em modo suporte (so leitura). Frente D da fase 2.
//
// Como a sessao de suporte funciona (detalhes em backend/src/seguranca/sessaoSuporte.js):
// o admin troca a propria sessao por uma de 30 min, so leitura, no negocio.
// Encerrar apaga a sessao e leva pra tela de login do painel (o admin entra
// de novo com senha + codigo). Nada da sessao do admin fica guardado.
import { useEffect, useState } from 'react';
import { Eye, LogOut } from 'lucide-react';
import api, { definirCsrf } from '../../services/api';
import { useAuthStore } from '../../store/auth.store';

function sairPraLogin() {
  definirCsrf(null);
  useAuthStore.setState({ user: null, isAuthenticated: false });
  window.location.assign('/admin/login?suporte=encerrado');
}

export default function FaixaSuporte() {
  const suporte = useAuthStore((s) => s.user?.suporte);
  const [saindo, setSaindo] = useState(false);
  const [erro, setErro] = useState('');

  // Quando os 30 min acabam, a API passa a recusar; a faixa ja leva pro login.
  useEffect(() => {
    if (!suporte?.expiraEm) return undefined;
    const falta = new Date(suporte.expiraEm).getTime() - Date.now();
    const t = setTimeout(sairPraLogin, Math.max(0, falta) + 1000);
    return () => clearTimeout(t);
  }, [suporte?.expiraEm]);

  if (!suporte) return null;

  const encerrar = async () => {
    setSaindo(true);
    setErro('');
    try {
      await api.post('/suporte/sessao/encerrar');
      sairPraLogin();
    } catch (e) {
      // Sessao ja vencida (401): so volta pro login.
      if (e.response?.status === 401) { sairPraLogin(); return; }
      setErro(e.response?.data?.erro || 'Não foi possível encerrar. Tente de novo.');
      setSaindo(false);
    }
  };

  const ate = suporte.expiraEm
    ? new Date(suporte.expiraEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3 text-[var(--warning-text)]">
      <Eye size={18} aria-hidden="true" className="flex-shrink-0" />
      <p className="flex-1 min-w-[220px] text-sm">
        <strong>Sessão de suporte, só leitura</strong>
        {suporte.clienteNome ? ` em ${suporte.clienteNome}` : ''} · {suporte.adminNome}
        {ate ? ` · termina às ${ate}` : ''}. Nada pode ser criado ou alterado; tudo fica na auditoria.
        {erro && <span className="block mt-1 font-semibold">{erro}</span>}
      </p>
      <button
        type="button"
        onClick={encerrar}
        disabled={saindo}
        className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-sm font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--primary)]"
      >
        <LogOut size={16} aria-hidden="true" />
        {saindo ? 'Encerrando…' : 'Encerrar'}
      </button>
    </div>
  );
}

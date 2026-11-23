// Comunicado mais recente da plataforma, com botao de fechar. Frente D da fase 2.
// Fica ate a pessoa fechar ("fechado" = a notificacao DELA marcada como lida;
// cada pessoa do negocio fecha a sua). Na sessao de suporte (so leitura) a
// faixa aparece sem o botao de fechar.
import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../store/auth.store';

export default function FaixaComunicado() {
  const emSuporte = useAuthStore((s) => Boolean(s.user?.suporte));
  const [comunicado, setComunicado] = useState(null);
  const [fechando, setFechando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    api.get('/comunicados/atual')
      .then((r) => { if (ativo) setComunicado(r.data || null); })
      .catch(() => { /* sem faixa se falhar: nao atrapalha o uso */ });
    return () => { ativo = false; };
  }, []);

  if (!comunicado) return null;

  const fechar = async () => {
    setFechando(true);
    setErro('');
    try {
      await api.post(`/comunicados/${comunicado.notificacaoId}/fechar`);
      // Pode haver outro comunicado mais antigo nao lido: mostra o proximo.
      const r = await api.get('/comunicados/atual').catch(() => ({ data: null }));
      setComunicado(r.data || null);
    } catch {
      setErro('Não foi possível fechar agora. Tente de novo.');
    } finally {
      setFechando(false);
    }
  };

  return (
    <section aria-label="Comunicado do Sellergy" className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--info-soft)] bg-[var(--info-soft)] px-4 py-3 text-[var(--info-text)]">
      <Megaphone size={18} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{comunicado.titulo}</p>
        <p className="text-sm mt-0.5 whitespace-pre-wrap break-words">{comunicado.texto}</p>
        {erro && <p className="text-xs font-semibold mt-1" role="alert">{erro}</p>}
      </div>
      {!emSuporte && (
        <button
          type="button"
          onClick={fechar}
          disabled={fechando}
          aria-label="Fechar comunicado"
          className="flex-shrink-0 inline-flex items-center justify-center w-11 h-11 -my-1 -mr-2 rounded-lg hover:bg-[var(--bg-card)]/60 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

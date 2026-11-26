import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, KeyRound } from 'lucide-react';
import api from '../../services/api';
import { Badge } from '../ui';

/**
 * Resumo da IA da plataforma (uma chave só, da Sellergy, vale pra todos os
 * clientes) no modal "IA do bot". Trocar provedor, modelo ou chave é em
 * Admin › Integrações (FormIAPlataforma) — aqui só mostra.
 * `onMudou(configurada, info)` avisa o modal (info: { provedor, modelo }).
 */
export default function ChaveIAPlataforma({ onMudou }) {
  const [info, setInfo] = useState(undefined); // undefined = carregando

  useEffect(() => {
    let vivo = true;
    api.get('/admin/plataforma/ia')
      .then((r) => { if (vivo) { setInfo(r.data); onMudou?.(!!r.data?.configurada, r.data); } })
      .catch(() => { if (vivo) setInfo(null); });
    return () => { vivo = false; };
  }, [onMudou]);

  if (info === undefined) {
    return <div className="h-10 rounded-lg bg-[var(--bg-subtle)] animate-pulse" aria-label="Carregando" />;
  }
  const ok = !!info?.configurada;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound size={16} aria-hidden="true" className="text-[var(--text-muted)]" />
        <span className="text-sm font-medium text-[var(--text-main)] flex-1 min-w-0">IA da plataforma</span>
        {ok
          ? <Badge variant="success" size="sm" icon={CircleCheck}>{info.provedor === 'OPENROUTER' ? 'OpenRouter' : 'DeepSeek'}</Badge>
          : <Badge variant="warning" size="sm">Não configurada</Badge>}
      </div>
      <p className="m-0 text-xs text-[var(--text-muted)]">
        {ok
          ? (info.provedor === 'OPENROUTER' ? `Todos os clientes usam ${info.modelo}. ` : 'Chave da DeepSeek, uma só para todos os clientes. ')
          : 'Sem ela, bot com IA ligada responde que está indisponível. '}
        <Link to="/admin/integracoes" className="font-semibold">{ok ? 'Mudar em Integrações' : 'Configurar em Integrações'}</Link>
      </p>
    </div>
  );
}

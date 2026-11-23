import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ArrowRight, Copy } from 'lucide-react';
import clsx from 'clsx';
import { useToast } from '../ui';
import { useResumoConta } from './useResumoConta';

// "Primeiros passos" no Inicio: some quando tudo esta feito. Os passos vem
// do backend, calculados dos dados reais (src/onboarding/passos.js).

export default function InicioChecklist() {
  const { resumo } = useResumoConta();
  const toast = useToast();
  const inicio = resumo?.inicio;
  if (!inicio || inicio.completo) return null;

  const slug = resumo.configuracoes?.slugPublico;
  const temLink = resumo.plano?.recursos?.linkAgendamento && slug && resumo.negocio?.segmento !== 'PRODUTO';
  const link = temLink ? `${window.location.origin}/agendar/${slug}` : null;
  const pct = Math.round((inicio.feitos / inicio.total) * 100);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast?.success?.('Link copiado. Cole na bio do Instagram e no WhatsApp.');
    } catch {
      toast?.error?.('Não foi possível copiar. Selecione o link e copie.');
    }
  };

  return (
    <section className="bg-[var(--bg-card)] border border-[var(--border-main)] rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-main)]">Primeiros passos</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{inicio.feitos} de {inicio.total} feitos</p>
        </div>
        <div className="w-28 h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden" aria-hidden>
          <div className="h-full bg-[var(--success)]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ol className="mt-4 divide-y divide-[var(--border-main)]">
        {inicio.passos.map((p) => {
          const proximo = p.chave === inicio.proximo;
          return (
            <li key={p.chave}>
              <Link to={p.rota} className={clsx('flex items-center gap-3 py-2.5 group', p.concluido && 'opacity-60')}>
                {p.concluido
                  ? <CheckCircle2 size={18} className="text-[var(--success)] flex-shrink-0" />
                  : <Circle size={18} className="text-[var(--text-muted)] flex-shrink-0" />}
                <span className={clsx('flex-1 text-sm', p.concluido ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-main)]', proximo && 'font-semibold')}>
                  {p.titulo}
                </span>
                {!p.concluido && <ArrowRight size={14} className="text-[var(--text-muted)] group-hover:text-[var(--text-main)]" />}
              </Link>
            </li>
          );
        })}
      </ol>

      {link && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--bg-subtle)] px-3 py-2">
          <span className="text-xs text-[var(--text-muted)]">Seu link:</span>
          <code className="flex-1 truncate text-xs text-[var(--text-main)]">{link}</code>
          <button type="button" onClick={copiar} className="text-[var(--text-secondary)] hover:text-[var(--text-main)]" aria-label="Copiar link de agendamento">
            <Copy size={14} />
          </button>
        </div>
      )}
    </section>
  );
}

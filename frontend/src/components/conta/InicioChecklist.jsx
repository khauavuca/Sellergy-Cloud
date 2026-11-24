import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ArrowRight, Copy } from 'lucide-react';
import clsx from 'clsx';
import { useToast, Painel } from '../ui';
import { useResumoConta } from './useResumoConta';

// "Primeiros passos" no Inicio (coluna da direita): some quando tudo esta
// feito. Os passos vem do backend, calculados dos dados reais
// (src/onboarding/passos.js).

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
    <Painel
      titulo="Primeiros passos"
      subtitulo={`${inicio.feitos} de ${inicio.total} feitos`}
      id="primeiros-passos"
      semPadding
      acoes={(
        <div className="w-20 h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden" aria-hidden="true">
          <div className="h-full bg-[var(--success)]" style={{ width: `${pct}%` }} />
        </div>
      )}
    >
      <ol className="m-0 p-0 list-none">
        {inicio.passos.map((p) => {
          const proximo = p.chave === inicio.proximo;
          return (
            <li key={p.chave} className="border-b border-[var(--border-subtle)] last:border-b-0">
              <Link
                to={p.rota}
                className={clsx('flex items-center gap-2.5 px-4 py-2 group hover:bg-[var(--bg-subtle)]', p.concluido && 'opacity-60')}
              >
                {p.concluido
                  ? <CheckCircle2 size={16} className="text-[var(--success)] flex-shrink-0" aria-label="Feito" />
                  : <Circle size={16} className="text-[var(--text-muted)] flex-shrink-0" aria-hidden="true" />}
                <span className={clsx('flex-1 min-w-0 text-[13px]', p.concluido ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-main)]', proximo && 'font-semibold')}>
                  {p.titulo}
                </span>
                {!p.concluido && <ArrowRight size={14} className="text-[var(--text-muted)] group-hover:text-[var(--text-main)] flex-shrink-0" aria-hidden="true" />}
              </Link>
            </li>
          );
        })}
      </ol>

      {link && (
        <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-2 rounded-b-[10px]">
          <span className="text-xs text-[var(--text-muted)] flex-shrink-0">Seu link:</span>
          <code className="flex-1 min-w-0 truncate text-xs text-[var(--text-main)]">{link}</code>
          <button
            type="button"
            onClick={copiar}
            className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-main)]"
            aria-label="Copiar link de agendamento"
          >
            <Copy size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </Painel>
  );
}

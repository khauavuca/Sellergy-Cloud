import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Painel, Badge } from '../ui';

// "Seu negócio está X% pronto": os mesmos passos do checklist do Início
// (backend: src/onboarding/passos.js), calculados dos dados reais.
export default function ProntidaoNegocio({ inicio, carregando }) {
  if (carregando) {
    return (
      <Painel titulo="Seu negócio está…">
        <div className="h-2 rounded-full bg-[var(--bg-subtle)] animate-pulse" />
      </Painel>
    );
  }
  if (!inicio || !inicio.total) return null;

  const pct = Math.round((inicio.feitos / inicio.total) * 100);

  return (
    <Painel
      titulo={inicio.completo ? 'Seu negócio está 100% pronto' : `Seu negócio está ${pct}% pronto`}
      subtitulo={`${inicio.feitos} de ${inicio.total} passos feitos`}
      semPadding
    >
      <div className="px-4 pt-3 pb-1">
        <div
          className="h-2 rounded-full bg-[var(--bg-subtle)] overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Andamento da configuração"
        >
          <div className="h-full rounded-full bg-[var(--success)]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="m-0 p-0 list-none">
        {inicio.passos.map((p) => (
          <li key={p.chave} className="border-b border-[var(--border-subtle)] last:border-b-0">
            {p.concluido ? (
              <div className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[var(--text-secondary)]">
                <Badge variant="success" size="sm">Feito</Badge>
                <span className="flex-1 min-w-0">{p.titulo}</span>
              </div>
            ) : (
              <Link to={p.chave === 'horario' ? '/app/configuracoes?secao=horario' : p.rota} className="group flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[var(--primary)] font-medium hover:bg-[var(--bg-subtle)]">
                <Badge variant="warning" size="sm">Falta</Badge>
                <span className="flex-1 min-w-0">{p.titulo}</span>
                <ArrowRight size={14} aria-hidden="true" className="flex-shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-main)]" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Painel>
  );
}

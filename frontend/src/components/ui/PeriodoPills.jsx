// =====================================================================
// PeriodoPills — seleção de período em chips horizontais
// =====================================================================
// Substitui o dropdown de período por um conjunto de pílulas visuais.
// Padrão usado em Stone, Mercado Pago, Notion. Mais escaneável e
// reduz cliques (1 clique vs 2 do dropdown).
//
// Quando "Personalizado" é escolhido, aparecem dois campos de data
// inline (sem virar um formulário separado).

import { Calendar } from 'lucide-react';
import clsx from 'clsx';
import { PRESETS_PERIODO } from './periodo';

export default function PeriodoPills({
  preset,
  onPresetChange,
  customInicio = '',
  customFim = '',
  onCustomInicio,
  onCustomFim,
  intervalo,
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mr-1">
          <Calendar size={12} />
          Período
        </div>
        {PRESETS_PERIODO.map((p) => {
          const ativo = preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onPresetChange(p.value)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border',
                ativo
                  ? 'bg-[var(--primary)] text-[var(--text-on-primary)] border-[var(--primary)]'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-main)] hover:border-[var(--text-muted)] hover:text-[var(--text-main)]'
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {preset === 'custom' && (
        <div className="flex items-center gap-2 pl-1">
          <input
            type="date"
            value={customInicio}
            onChange={(e) => onCustomInicio?.(e.target.value)}
            className="h-9 px-3 text-sm rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-main)] focus:outline-none focus:border-[var(--primary)]"
          />
          <span className="text-xs text-[var(--text-muted)]">até</span>
          <input
            type="date"
            value={customFim}
            onChange={(e) => onCustomFim?.(e.target.value)}
            className="h-9 px-3 text-sm rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-main)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      )}

      {intervalo && (
        <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
          <Calendar size={11} />
          {intervalo.inicio.toLocaleDateString('pt-BR')} até {intervalo.fim.toLocaleDateString('pt-BR')}
        </div>
      )}
    </div>
  );
}

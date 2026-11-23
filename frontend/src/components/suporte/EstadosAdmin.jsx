// Estados padrao das telas do painel admin (frente D da fase 2).
import { ShieldAlert } from 'lucide-react';

export function SemPermissao({ texto = 'Seu papel na equipe não dá acesso a esta área. Fale com o dono da conta Sellergy.' }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5">
      <ShieldAlert size={20} className="text-[var(--warning)] flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-[var(--text-main)]">Sem acesso</p>
        <p className="text-sm text-[var(--text-secondary)] mt-1">{texto}</p>
      </div>
    </div>
  );
}

export function ErroCarregar({ texto, onTentar }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-text)]">
      <span className="flex-1 min-w-[200px]">{texto}</span>
      {onTentar && (
        <button
          type="button"
          onClick={onTentar}
          className="min-h-11 px-4 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[var(--text-main)] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function Carregando({ linhas = 3 }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando</span>
      {Array.from({ length: linhas }, (_, i) => <div key={i} className="h-12 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />)}
    </div>
  );
}

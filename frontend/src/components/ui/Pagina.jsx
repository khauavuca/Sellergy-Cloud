// =====================================================================
// MOLDES DAS TELAS INTERNAS (layout "cara de sistema", tela cheia)
// =====================================================================
// Toda tela interna segue o mesmo desenho do mockup aprovado:
//
//   <Pagina>
//     <FaixaNumeros>                      ← números do topo (auto-fit)
//       <Numero rotulo="Vendido hoje" valor="R$ 1.284,50" detalhe="+18%" tom="sucesso" />
//     </FaixaNumeros>
//     <ColunasPagina lateral={<>…cartões da direita…</>}>
//       <Painel titulo="Próximos horários" acoes={<Button …/>} semPadding>
//         …tabela…
//       </Painel>
//     </ColunasPagina>
//   </Pagina>
//
// - O conteúdo principal estica; a coluna da direita tem ~320px e desce
//   pra baixo do principal quando a tela é estreita (nada de espaço vazio).
// - Tudo usa as variáveis de cor do tema (claro e escuro funcionam).
// =====================================================================

import clsx from 'clsx';

/** Coluna da página: empilha os blocos com o espaçamento padrão. */
export function Pagina({ children, className }) {
  return <div className={clsx('flex flex-col gap-4', className)}>{children}</div>;
}

/** Linha de números no topo da tela. */
export function FaixaNumeros({ children, min = 180, className }) {
  return (
    <div
      className={clsx('grid gap-3', className)}
      // No celular cabem 2 por linha (45%); no computador, pelo menos `min`px cada.
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 45%), 1fr))` }}
    >
      {children}
    </div>
  );
}

const TONS = {
  neutro: 'text-[var(--text-main)]',
  sucesso: 'text-[var(--success-text)]',
  alerta: 'text-[var(--warning-text)]',
  perigo: 'text-[var(--danger-text)]',
  info: 'text-[var(--info-text)]',
};

/**
 * Um número da faixa do topo.
 * tom: cor do valor; tomDetalhe: cor da linha de baixo.
 * destaque: cartão escuro (use 1 por tela, no número mais importante).
 */
export function Numero({
  rotulo,
  valor,
  detalhe,
  tom = 'neutro',
  tomDetalhe = 'neutro',
  icone: Icone,
  destaque = false,
  carregando = false,
  progresso,
  onClick,
  className,
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'text-left rounded-[10px] border px-4 py-3.5 min-w-0',
        destaque
          ? 'bg-[var(--sb-bg)] border-[var(--sb-bg)]'
          : 'bg-[var(--bg-card)] border-[var(--border-main)]',
        onClick && 'cursor-pointer hover:border-[var(--border-strong)] transition-colors',
        className
      )}
    >
      <div className={clsx('flex items-center gap-2 text-xs font-medium', destaque ? 'text-[#9FB5AA]' : 'text-[var(--text-muted)]')}>
        {Icone && <Icone size={14} aria-hidden="true" className="flex-shrink-0" />}
        <span className="truncate">{rotulo}</span>
      </div>
      {carregando ? (
        <div className="h-7 w-24 mt-1.5 rounded-md bg-[var(--bg-subtle)] animate-pulse" />
      ) : (
        <div
          className={clsx(
            'mt-1 text-[22px] font-bold tracking-tight tabular-nums truncate',
            destaque ? 'text-white' : TONS[tom] || TONS.neutro
          )}
        >
          {valor}
        </div>
      )}
      {typeof progresso === 'number' && (
        <div className="h-1.5 rounded-full bg-[var(--bg-subtle)] mt-2.5" aria-hidden="true">
          <div className="h-1.5 rounded-full bg-[var(--primary)]" style={{ width: `${Math.max(0, Math.min(100, progresso))}%` }} />
        </div>
      )}
      {detalhe && (
        <div
          className={clsx(
            'mt-1 text-xs truncate',
            destaque ? 'text-[#7FE0B4] font-semibold' : tomDetalhe === 'neutro' ? 'text-[var(--text-muted)]' : clsx(TONS[tomDetalhe], 'font-semibold')
          )}
        >
          {detalhe}
        </div>
      )}
    </Tag>
  );
}

/**
 * Conteúdo principal + coluna lateral direita.
 * Sem `lateral`, o principal ocupa tudo.
 */
export function ColunasPagina({ children, lateral, larguraLateral = 320, className }) {
  return (
    <div className={clsx('flex flex-wrap gap-4 items-start', className)}>
      <div className="min-w-0 flex flex-col gap-4" style={{ flex: '999 1 640px' }}>
        {children}
      </div>
      {lateral && (
        <aside className="min-w-0 flex flex-col gap-4" style={{ flex: `1 1 ${larguraLateral}px` }}>
          {lateral}
        </aside>
      )}
    </div>
  );
}

/**
 * Cartão com cabeçalho (título, subtítulo, ações à direita).
 * semPadding: o corpo encosta nas bordas (tabelas, listas de LinhaInfo).
 */
export function Painel({ titulo, subtitulo, acoes, children, semPadding = false, className, corpoClassName, id, as: Tag = 'section' }) {
  const idTitulo = id ? `${id}-titulo` : undefined;
  return (
    <Tag
      id={id}
      aria-labelledby={titulo ? idTitulo : undefined}
      className={clsx('rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0', className)}
    >
      {(titulo || acoes) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
          <div className="min-w-0">
            {titulo && (
              <h2 id={idTitulo} className="m-0 text-sm font-bold text-[var(--text-main)] tracking-tight">
                {titulo}
              </h2>
            )}
            {subtitulo && <p className="m-0 mt-0.5 text-xs text-[var(--text-muted)]">{subtitulo}</p>}
          </div>
          {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
        </div>
      )}
      <div className={clsx(!semPadding && 'p-4', corpoClassName)}>{children}</div>
    </Tag>
  );
}

/** Linha "rótulo ........ valor" dentro de um Painel semPadding. */
export function LinhaInfo({ rotulo, valor, children, forte = false, className }) {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0 text-[13px] text-[var(--text-secondary)] min-w-0',
        className
      )}
    >
      <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">{rotulo}</span>
      {valor !== undefined && (
        <span className={clsx('text-[var(--text-main)] tabular-nums', forte ? 'font-bold' : 'font-semibold')}>{valor}</span>
      )}
      {children}
    </div>
  );
}

/** Faixa de filtros/abas/ações no topo de um Painel ou da tela. */
export function BarraFerramentas({ children, className }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-[var(--border-subtle)]', className)}>
      {children}
    </div>
  );
}

/** Abas compactas (pílulas) usadas dentro de BarraFerramentas. */
export function AbasPilula({ abas, valor, onChange, rotulo = 'Filtro' }) {
  return (
    <div role="tablist" aria-label={rotulo} className="flex flex-wrap gap-1">
      {abas.map((a) => {
        const ativa = a.valor === valor;
        return (
          <button
            key={a.valor}
            type="button"
            role="tab"
            aria-selected={ativa}
            onClick={() => onChange(a.valor)}
            className={clsx(
              'h-9 px-3 rounded-lg text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors',
              ativa ? 'bg-[var(--text-main)] text-[var(--bg-card)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
            )}
          >
            {a.rotulo}
            {a.qtd != null && <span className="opacity-70 tabular-nums">{a.qtd}</span>}
          </button>
        );
      })}
    </div>
  );
}

import clsx from 'clsx';
import { Check, AlertTriangle, X } from 'lucide-react';

// Cartão de comparação de uma forma de conexão do WhatsApp (oficial ou QR
// Code): situação atual, vantagens/limites e as ações daquela conexão.
// `itens`: [{ texto, tipo: 'ok' | 'aviso' | 'nao' }]
const ICONE_ITEM = {
  ok: { Icone: Check, cor: 'text-[var(--success-text)]' },
  aviso: { Icone: AlertTriangle, cor: 'text-[var(--warning-text)]' },
  nao: { Icone: X, cor: 'text-[var(--danger-text)]' },
};

const COR_PONTO = {
  sucesso: 'bg-[var(--success)]',
  alerta: 'bg-[var(--warning)]',
  perigo: 'bg-[var(--danger)]',
  neutro: 'bg-[var(--border-strong)]',
};

export default function CartaoConexao({
  id, titulo, etiqueta, destaque = false, situacao, tomSituacao = 'neutro', detalheSituacao, itens = [], rodape, acoes,
}) {
  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className={clsx(
        'rounded-[10px] border bg-[var(--bg-card)] min-w-0 flex flex-col',
        destaque ? 'border-[var(--accent-border)]' : 'border-[var(--border-main)]'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3.5 border-b border-[var(--border-subtle)]">
        <h2 id={`${id}-titulo`} className="m-0 text-sm font-bold text-[var(--text-main)] tracking-tight">{titulo}</h2>
        {etiqueta}
      </div>
      <div className="px-4 py-3.5 flex flex-col gap-3 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-main)]">
          <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', COR_PONTO[tomSituacao] || COR_PONTO.neutro)} aria-hidden="true" />
          <strong>{situacao}</strong>
          {detalheSituacao && <span className="text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">· {detalheSituacao}</span>}
        </div>
        <ul className="m-0 p-0 list-none flex flex-col gap-2 text-[13px] text-[var(--text-secondary)]">
          {itens.map((item) => {
            const { Icone, cor } = ICONE_ITEM[item.tipo] || ICONE_ITEM.ok;
            return (
              <li key={item.texto} className="flex gap-2 items-start leading-snug">
                <Icone size={15} strokeWidth={2.5} className={clsx('flex-shrink-0 mt-0.5', cor)} aria-hidden="true" />
                <span>{item.texto}</span>
              </li>
            );
          })}
        </ul>
        {rodape && <div className="text-xs text-[var(--text-muted)] leading-relaxed">{rodape}</div>}
        {acoes && <div className="flex flex-wrap gap-2 mt-auto">{acoes}</div>}
      </div>
    </section>
  );
}

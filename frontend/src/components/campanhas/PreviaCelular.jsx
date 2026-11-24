// Prévia "como chega no celular" das campanhas: um celular simplificado com
// o balão da mensagem. Só usa cores do tema (funciona no claro e no escuro).
// O texto é o que a loja escreveu; o envio real usa o template aprovado na Meta.

export default function PreviaCelular({ texto, remetente = 'Sua loja', vazio = 'Escreva a mensagem para ver a prévia.' }) {
  const iniciais = String(remetente || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || 'SL';

  return (
    <div className="p-4 grid place-items-center bg-[var(--bg-subtle)]">
      <div
        className="w-[248px] max-w-full rounded-[28px] overflow-hidden border-[8px] border-[var(--text-main)] bg-[var(--bg-app)]"
        role="img"
        aria-label={texto ? `Prévia da mensagem: ${texto}` : 'Prévia da mensagem vazia'}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--primary)] text-[var(--text-on-primary)]">
          <span className="w-[26px] h-[26px] rounded-full grid place-items-center text-[10px] font-bold bg-[var(--primary-soft)] text-[var(--primary)]">
            {iniciais}
          </span>
          <span className="text-xs font-semibold truncate">{remetente}</span>
        </div>
        <div className="flex flex-col gap-1.5 px-2.5 pt-3 pb-4 min-h-[220px]">
          <div className="rounded-lg rounded-tl-sm px-2.5 py-2 bg-[var(--bg-card)] text-xs leading-[1.45] text-[var(--text-main)] whitespace-pre-wrap [overflow-wrap:anywhere]">
            {texto || <span className="text-[var(--text-muted)]">{vazio}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

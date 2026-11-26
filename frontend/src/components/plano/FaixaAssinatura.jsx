import clsx from 'clsx';
import { AlertCircle, ExternalLink, Info } from 'lucide-react';
import { Badge, Button } from '../ui';
import { brl, competencia } from '../conta/rotulosAssinatura';

const linkPagar = 'inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-bold flex-shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

/**
 * Faixa do topo de Meu plano: situação do teste/assinatura.
 * - Teste: dias que faltam + barra "Dia X de Y" + botão de assinar.
 * - Atraso, suspensa, teste vencido: bloco vermelho (visual de Conta suspensa)
 *   com o valor em aberto e o botão de pagar.
 */
export default function FaixaAssinatura({
  assinatura: a, status, nomePlanoEfetivo, diasDeTeste, textoPasso, pendencias, podeTrocar, onEscolherPlano,
}) {
  const critico = (a.somenteLeitura && a.aviso !== 'CONTA_CANCELADA') || a.aviso === 'PAGAMENTO_ATRASADO';
  const fatura = pendencias.pagarPrimeiro;
  const pagavel = fatura?.linkPagamento && (fatura.status === 'ABERTA' || fatura.status === 'VENCIDA');
  const rotuloEscolher = a.status === 'TRIAL' && !a.somenteLeitura ? `Assinar o ${nomePlanoEfetivo || 'plano'}` : 'Escolher plano';

  if (critico) {
    let titulo = 'Conta só para consulta';
    if (a.aviso === 'TRIAL_VENCIDO') titulo = 'Seu teste terminou';
    else if (pendencias.diasAtraso !== null && fatura) {
      titulo = `Fatura de ${competencia(fatura.competencia)} em aberto há ${pendencias.diasAtraso} ${pendencias.diasAtraso === 1 ? 'dia' : 'dias'}`;
    } else if (a.aviso === 'PAGAMENTO_ATRASADO') titulo = 'Há uma fatura vencida';
    const valor = pendencias.valorVencido > 0 ? pendencias.valorVencido : fatura ? Number(fatura.valor || 0) : null;
    return (
      <section
        role="alert"
        className="rounded-[10px] bg-[var(--danger)] text-white px-[18px] py-4 flex flex-wrap items-center gap-3.5"
      >
        <span className="w-10 h-10 rounded-full bg-white/15 grid place-items-center flex-shrink-0" aria-hidden="true">
          <AlertCircle size={20} />
        </span>
        <div className="min-w-0" style={{ flex: '1 1 280px' }}>
          <div className="text-base font-bold">{titulo}</div>
          <p className="m-0 mt-0.5 text-[13px] text-white/85">{textoPasso}</p>
        </div>
        {a.aviso !== 'TRIAL_VENCIDO' && valor !== null && (
          <div className="text-right flex-shrink-0">
            <div className="text-xs text-white/85">Valor em aberto</div>
            <div className="text-[22px] font-bold tabular-nums">{brl(valor)}</div>
          </div>
        )}
        {pagavel ? (
          <a
            href={fatura.linkPagamento}
            target="_blank"
            rel="noopener noreferrer"
            className={clsx(linkPagar, 'bg-[var(--bg-card)] text-[var(--danger-text)] hover:opacity-90 focus-visible:ring-[var(--bg-card)] focus-visible:ring-offset-[var(--danger)]')}
          >
            Pagar agora
            <ExternalLink size={14} aria-hidden="true" />
            <span className="sr-only">fatura de {competencia(fatura.competencia)} (abre em nova aba)</span>
          </a>
        ) : podeTrocar ? (
          <button
            type="button"
            onClick={onEscolherPlano}
            className={clsx(linkPagar, 'bg-[var(--bg-card)] text-[var(--danger-text)] hover:opacity-90 focus-visible:ring-[var(--bg-card)] focus-visible:ring-offset-[var(--danger)]')}
          >
            Escolher plano
          </button>
        ) : null}
      </section>
    );
  }

  const emTeste = a.status === 'TRIAL';
  const acabando = a.aviso === 'TRIAL_ACABANDO';
  const cancelada = a.aviso === 'CONTA_CANCELADA';
  const dias = a.diasRestantesTrial;
  const total = Number(diasDeTeste) || null;
  const diaAtual = emTeste && total && Number.isFinite(dias) ? Math.min(total, Math.max(1, total - dias)) : null;

  let titulo = `Plano ${a.planoContratado?.nome || '—'}`;
  if (emTeste) {
    titulo = `Teste grátis do ${nomePlanoEfetivo || 'plano'}: ${dias === 1 ? 'falta 1 dia' : `faltam ${dias} dias`}`;
  } else if (cancelada) titulo = 'Assinatura cancelada';

  const corBarra = acabando || cancelada ? 'bg-[var(--warning)]' : 'bg-[var(--primary)]';

  return (
    <section
      aria-label="Situação da assinatura"
      className={clsx(
        'relative overflow-hidden rounded-[10px] border pl-5 pr-4 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-3',
        acabando || cancelada
          ? 'bg-[var(--warning-soft)] border-[var(--warning-soft)]'
          : 'bg-[var(--bg-card)] border-[var(--border-main)]'
      )}
    >
      <span className={clsx('absolute left-0 top-0 bottom-0 w-1', corBarra)} aria-hidden="true" />
      <div className="min-w-0" style={{ flex: '1 1 320px' }}>
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-[15px] text-[var(--text-main)]">{titulo}</strong>
          <Badge variant={status.variante} size="sm">{status.rotulo}</Badge>
        </div>
        <p className="m-0 mt-1 text-[13px] text-[var(--text-secondary)] flex gap-1.5">
          {(acabando || cancelada) && <Info size={14} className="flex-shrink-0 mt-0.5 text-[var(--warning-text)]" aria-hidden="true" />}
          <span>{textoPasso}</span>
        </p>
      </div>
      {diaAtual !== null && (
        <div className="min-w-[160px]" style={{ flex: '0 1 200px' }}>
          <div className="text-xs font-medium text-[var(--text-muted)]">Dia {diaAtual} de {total}</div>
          <div
            className="h-2 rounded bg-[var(--bg-subtle)] mt-1.5"
            role="progressbar"
            aria-label="Dias de teste usados"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={diaAtual}
          >
            <div className={clsx('h-2 rounded', corBarra)} style={{ width: `${(diaAtual / total) * 100}%` }} />
          </div>
        </div>
      )}
      {podeTrocar && (emTeste || cancelada) && (
        <Button className="flex-shrink-0" onClick={onEscolherPlano}>{rotuloEscolher}</Button>
      )}
    </section>
  );
}

import clsx from 'clsx';
import { Check } from 'lucide-react';
import { AbasPilula, Badge, Button, Painel } from '../ui';
import { brl } from '../conta/rotulosAssinatura';
import { anualMensal, anualTotal, num, temLimite } from './planoUtil';

const DESCRICAO_RECURSOS = {
  notaFiscal: 'Nota fiscal (NFC-e e NFS-e)',
  campanhas: 'Campanhas e recompra',
  pacotes: 'Pacotes de sessões',
  linkAgendamento: 'Link de agendamento online',
  catalogoOnline: 'Catálogo online',
  atendimentoIa: 'Atendimento com IA',
  relatoriosAvancados: 'Relatórios avançados',
};

const textoLimite = (v, plural) => (temLimite(v) ? `${num(v)} ${plural}` : `${plural} ilimitados`);

function itensDo(p) {
  return [
    `${textoLimite(p.limites?.usuarios, 'usuários')} e ${textoLimite(p.limites?.profissionais, 'profissionais')}`,
    `${textoLimite(p.limites?.lembretesMes, 'lembretes')} por mês`,
    'Agenda, vendas, caixa, estoque e Pix',
    ...Object.entries(DESCRICAO_RECURSOS).filter(([k]) => p.recursos?.[k]).map(([, txt]) => txt),
  ];
}

/**
 * Planos lado a lado com Mensal/Anual. "Assinar" abre o modal de planos,
 * onde a pessoa escolhe a forma de pagamento e confirma.
 */
export default function CartoesPlanos({
  planos, carregando, erro, onTentarDeNovo, anual, onMudarCiclo, assinatura: a, podeTrocar, onAssinar,
}) {
  const emTeste = a?.status === 'TRIAL' && !a?.somenteLeitura;
  const codigoAtual = emTeste ? a?.planoEfetivo : ['ATIVA', 'ATRASADA', 'SUSPENSA'].includes(a?.status) ? a?.planoContratado?.codigo : null;

  return (
    <Painel
      id="planos"
      titulo="Planos"
      subtitulo="Preço fixo por negócio. Sem fidelidade."
      acoes={(
        <AbasPilula
          rotulo="Período de cobrança"
          valor={anual ? 'anual' : 'mensal'}
          onChange={(v) => onMudarCiclo(v === 'anual')}
          abas={[{ valor: 'mensal', rotulo: 'Mensal' }, { valor: 'anual', rotulo: 'Anual · 20% off' }]}
        />
      )}
    >
      {carregando && planos.length === 0 ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }} aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-64 rounded-[10px] bg-[var(--bg-subtle)] animate-pulse" />)}
        </div>
      ) : erro && planos.length === 0 ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--danger-text)]">
          Não foi possível carregar os planos.
          <Button variant="secondary" size="sm" onClick={onTentarDeNovo}>Tentar de novo</Button>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {planos.map((p) => {
            const atual = codigoAtual === p.codigo;
            const valorMes = anual ? anualMensal(p) : Number(p.precoMensal);
            let rotulo = `Assinar ${p.nome}`;
            if (atual && !emTeste) rotulo = 'Continuar neste';
            return (
              <div
                key={p.codigo}
                className={clsx(
                  'rounded-[10px] p-4 flex flex-col gap-3 min-w-0',
                  atual ? 'border-2 border-[var(--primary)]' : 'border border-[var(--border-main)]'
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0 text-[15px] font-bold text-[var(--text-main)]">{p.nome}</h3>
                  {atual && <Badge variant="success" size="sm">{emTeste ? 'No seu teste' : 'Seu plano'}</Badge>}
                </div>
                <div>
                  <span className="text-2xl font-bold text-[var(--text-main)] tabular-nums">{brl(valorMes)}</span>
                  <span className="text-xs font-medium text-[var(--text-muted)]"> /mês</span>
                  <div className="text-xs text-[var(--text-muted)]">
                    {anual ? `${brl(anualTotal(p))} por ano` : 'cobrado todo mês'}
                  </div>
                </div>
                <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-[13px] text-[var(--text-secondary)] flex-1">
                  {itensDo(p).map((t) => (
                    <li key={t} className="flex gap-2">
                      <Check size={14} className="mt-0.5 text-[var(--success)] flex-shrink-0" aria-hidden="true" />
                      <span className="min-w-0">{t}</span>
                    </li>
                  ))}
                </ul>
                {podeTrocar && (
                  <Button variant={atual ? 'primary' : 'secondary'} fullWidth onClick={onAssinar}>
                    {rotulo}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Painel>
  );
}

// Resumo dos pacotes de sessoes dentro do Catalogo (so leitura).
// Os dados vem dos mesmos endpoints da tela Pacotes (/pacotes/modelos e
// /pacotes/clientes); vender, editar e cancelar continuam na tela Pacotes.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Package } from 'lucide-react';
import { Painel, Badge, EmptyState } from '../ui';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d) => new Date(d).toLocaleDateString('pt-BR');
const STATUS = {
  ATIVO: { label: 'Ativo', variant: 'success' },
  ACABOU: { label: 'Acabou', variant: 'neutral' },
  VENCIDO: { label: 'Vencido', variant: 'warning' },
  CANCELADO: { label: 'Cancelado', variant: 'danger' },
};

function textoValidade(dias) {
  if (!dias) return '';
  if (dias % 30 === 0) return `${dias / 30} ${dias / 30 === 1 ? 'mês' : 'meses'}`;
  return `${dias} dias`;
}

const linkCls = 'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] no-underline whitespace-nowrap';

export default function PainelPacotes({ modelos, clientes, carregando, semPlano, erro }) {
  const [aba, setAba] = useState('modelos');
  const aVenda = modelos.filter((m) => m.ativo);

  const abas = [
    { valor: 'modelos', rotulo: 'Pacotes à venda', qtd: aVenda.length },
    { valor: 'clientes', rotulo: 'Clientes com pacote', qtd: clientes.length },
  ];

  const cabecalho = (
    <div role="tablist" aria-label="Pacotes" className="flex flex-wrap gap-4">
      {abas.map((a) => {
        const ativa = aba === a.valor;
        return (
          <button
            key={a.valor}
            type="button"
            role="tab"
            aria-selected={ativa}
            onClick={() => setAba(a.valor)}
            className={`h-9 px-1 text-[13px] font-semibold border-b-2 transition-colors ${
              ativa ? 'text-[var(--primary)] border-[var(--primary)]' : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-main)]'
            }`}
          >
            {a.rotulo}
            {!carregando && <span className="ml-1.5 opacity-70 tabular-nums">{a.qtd}</span>}
          </button>
        );
      })}
    </div>
  );

  if (semPlano) {
    return (
      <Painel titulo="Pacotes de sessões" subtitulo="Venda 5, 10 sessões de um serviço com preço fechado.">
        <p className="m-0 text-[13px] text-[var(--text-secondary)]">
          Pacotes não fazem parte do seu plano. <Link to="/app/plano" className="font-semibold text-[var(--primary)]">Ver planos</Link>
        </p>
      </Painel>
    );
  }

  return (
    <Painel semPadding>
      {/* Cabecalho proprio: as abas nao podem ficar dentro do h2 do Painel. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 border-b border-[var(--border-subtle)]">
        <h2 className="sr-only">Pacotes de sessões</h2>
        {cabecalho}
        <Link to="/app/pacotes" className={linkCls}><Plus size={14} aria-hidden="true" />Novo pacote</Link>
      </div>
      {carregando ? (
        <div className="p-4 grid gap-3 sm:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />)}
        </div>
      ) : erro ? (
        <p className="m-0 px-4 py-6 text-[13px] text-center text-[var(--text-muted)]">{erro}</p>
      ) : aba === 'modelos' ? (
        aVenda.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Nenhum pacote à venda"
            description="Crie um pacote (ex.: 10 sessões de drenagem) na tela Pacotes."
          />
        ) : (
          <div className="flex flex-wrap">
            {aVenda.map((m) => (
              <div key={m.id} className="flex-[1_1_220px] min-w-0 px-4 py-3.5 border-r border-b border-[var(--border-subtle)]">
                <div className="flex items-start justify-between gap-2">
                  <strong className="text-[13px] text-[var(--text-main)] [overflow-wrap:anywhere]">{m.nome}</strong>
                  <Badge variant="neutral" size="sm">{m.clientesAtivas ?? 0} ativa(s)</Badge>
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  {[m.servico, m.validadeDias ? `validade ${textoValidade(m.validadeDias)}` : null, m.intervaloMinDias ? `intervalo mínimo ${m.intervaloMinDias} dias` : null].filter(Boolean).join(' · ')}
                </div>
                <div className="mt-2 text-lg font-bold tabular-nums text-[var(--text-main)]">{fmtBRL(m.preco)}</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {m.sessoes} sessões · sai {fmtBRL(m.valorSessao)} a sessão
                </div>
                <div className="mt-2.5">
                  <Link to="/app/pacotes" className={linkCls} aria-label={`Vender ou editar ${m.nome} na tela Pacotes`}>Vender ou editar</Link>
                </div>
              </div>
            ))}
          </div>
        )
      ) : clientes.length === 0 ? (
        <p className="m-0 px-4 py-6 text-[13px] text-center text-[var(--text-muted)]">Nenhuma cliente com pacote ativo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                {['Cliente', 'Pacote', 'Sessões', 'Pagamento', 'Validade'].map((t) => (
                  <th key={t} className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2.5 bg-[var(--bg-subtle)] border-b border-[var(--border-main)] whitespace-nowrap">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => {
                const pct = c.sessoesTotal ? Math.round((c.sessoesUsadas * 100) / c.sessoesTotal) : 0;
                const pago = c.parcelasPagas >= c.parcelas;
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] font-semibold text-[var(--text-main)]">{c.cliente?.nome}</td>
                    <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">{c.pacote}</td>
                    <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">
                      <div className="tabular-nums text-[var(--text-main)]">{c.sessoesUsadas} de {c.sessoesTotal} usadas</div>
                      <div className="h-1.5 w-24 rounded-full bg-[var(--bg-subtle)] mt-1" aria-hidden="true">
                        <div className="h-1.5 rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">
                      <Badge variant={pago ? 'success' : c.cobrancaPendente ? 'warning' : 'neutral'} size="sm">
                        {pago ? 'Quitado' : `${c.parcelasPagas} de ${c.parcelas} parcelas`}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">
                      <span className="text-[var(--text-secondary)]">até {fmtData(c.validoAte)}</span>{' '}
                      {c.acabando
                        ? <Badge variant="warning" size="sm">Acabando</Badge>
                        : c.status !== 'ATIVO' && <Badge variant={STATUS[c.status]?.variant} size="sm">{STATUS[c.status]?.label || c.status}</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Painel>
  );
}

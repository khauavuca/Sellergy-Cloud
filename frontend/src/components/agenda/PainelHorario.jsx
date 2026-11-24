import { useEffect, useState } from 'react';
import {
  CheckCircle2, XCircle, Edit2, Trash2, Lock, Sparkles, MessageCircle, Phone, History, X, CalendarClock,
} from 'lucide-react';
import api from '../../services/api';
import { Painel, LinhaInfo, Badge, Button } from '../ui';
import {
  STATUS_LABELS, SINAL_LABELS, fmtBRL, fmtHora, iniciais, ehAgendamentoImutavel, linkWhatsApp, coresPorStatus,
} from './agendaUtils';

// Coluna da direita da Agenda: detalhes e ações do horário selecionado
// (antes era uma gaveta). Sem seleção, mostra os próximos horários do período.

const btnSec = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-main)] hover:bg-[var(--bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

export default function PainelHorario({ ag, onFechar, onEditar, onExcluir, onStatus, onConcluir }) {
  // Histórico do agendamento aberto; enquanto o carregado for de outro, mostra carregando.
  const [hist, setHist] = useState({ id: null, itens: [] });
  const agId = ag?.id || null;
  useEffect(() => {
    if (!agId) return undefined;
    let vivo = true;
    api.get(`/agenda/${agId}/historico`)
      .then((r) => { if (vivo) setHist({ id: agId, itens: r.data || [] }); })
      .catch(() => { if (vivo) setHist({ id: agId, itens: [] }); });
    return () => { vivo = false; };
  }, [agId, ag?.status, ag?.data]);
  const historico = hist.id === agId ? hist.itens : [];
  const carregandoHist = !!agId && hist.id !== agId;

  if (!ag) return null;

  const status = STATUS_LABELS[ag.status] || { label: ag.status, variant: 'neutral' };
  const data = new Date(ag.data);
  const travado = ehAgendamentoImutavel(ag);
  const emAberto = !travado && (ag.status === 'PENDING' || ag.status === 'CONFIRMED');
  const whats = linkWhatsApp(ag.telefoneCliente);
  const cores = coresPorStatus(ag.status);
  const sinal = ag.sinalStatus ? SINAL_LABELS[ag.sinalStatus] || { label: ag.sinalStatus, variant: 'neutral' } : null;
  const valorConclusao = ag.pacote
    ? ' (desconta 1 sessão do pacote, sem cobrar)'
    : ag.sinalStatus === 'PAGO'
      ? ` (${fmtBRL(Math.max(0, (ag.preco || 0) - (ag.sinalValor || 0)))}, já descontado o sinal)`
      : ag.preco > 0 ? ` (${fmtBRL(ag.preco)})` : '';

  return (
    <>
      <Painel
        id="horario-selecionado"
        titulo="Horário selecionado"
        semPadding
        acoes={
          <>
            <Badge variant={status.variant}>{status.label}</Badge>
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar detalhes do horário"
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)]"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </>
        }
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)]">
          <span
            className="w-11 h-11 rounded-full grid place-items-center font-bold text-sm flex-shrink-0"
            style={{ backgroundColor: cores.soft, color: cores.text }}
            aria-hidden="true"
          >
            {iniciais(ag.nomeCliente)}
          </span>
          <div className="min-w-0">
            <div className="text-base font-bold text-[var(--text-main)] truncate">{ag.nomeCliente}</div>
            {ag.telefoneCliente ? (
              <a href={`tel:${ag.telefoneCliente}`} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]">
                <Phone size={12} aria-hidden="true" /> {ag.telefoneCliente}
              </a>
            ) : (
              <div className="text-xs text-[var(--text-muted)]">Sem telefone</div>
            )}
          </div>
        </div>

        {travado && (
          <div className="flex items-start gap-2.5 px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--info-soft)] text-[var(--info-text)]">
            <Lock size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="m-0 text-xs leading-relaxed">
              <strong>Agendamento travado.</strong> Itens passados com status atualizado ficam imutáveis para preservar o histórico. Edição e exclusão bloqueadas.
            </p>
          </div>
        )}

        <LinhaInfo
          rotulo="Quando"
          valor={<span className="first-letter:uppercase inline-block">{data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}, {fmtHora(data)}</span>}
          forte
        />
        <LinhaInfo rotulo="Duração" valor={`${ag.duracao} min`} />
        <LinhaInfo rotulo="Serviço" valor={ag.servico || '—'} />
        <LinhaInfo rotulo="Profissional" valor={ag.especialista?.nome || 'Sem profissional'} />
        <LinhaInfo rotulo="Valor" valor={ag.preco > 0 ? fmtBRL(ag.preco) : '—'} forte />
        {sinal && (
          <LinhaInfo rotulo={`Sinal de ${fmtBRL(ag.sinalValor)}`}>
            <Badge variant={sinal.variant} size="sm">
              {ag.sinalStatus === 'PENDENTE' && ag.sinalExpiraEm ? `Pendente até ${fmtHora(ag.sinalExpiraEm)}` : sinal.label}
            </Badge>
          </LinhaInfo>
        )}
        {ag.pacote && (
          <LinhaInfo rotulo={`Pacote ${ag.pacote.nome}`} valor={`${ag.pacote.sessoesUsadas} de ${ag.pacote.sessoesTotal} sessões`} />
        )}
        {(ag.origem === 'AI' || travado) && (
          <LinhaInfo rotulo="Origem">
            <span className="flex flex-wrap gap-1.5">
              {ag.origem === 'AI' && <Badge variant="accent" size="sm" icon={Sparkles}>Agendado pelo bot</Badge>}
              {travado && <Badge variant="info" size="sm" icon={Lock}>Imutável</Badge>}
            </span>
          </LinhaInfo>
        )}

        {ag.observacoes && (
          <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
            <div className="text-xs font-medium text-[var(--text-muted)] mb-1">Observações</div>
            <p className="m-0 text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">{ag.observacoes}</p>
          </div>
        )}

        {/* Ações. "Concluir" fecha o ciclo serviço→venda; "Não compareceu"
            cancela sem gerar venda. Só enquanto está em aberto e não travado. */}
        <div className="p-4 flex flex-col gap-2">
          {emAberto && (
            <>
              <Button variant="primary" icon={CheckCircle2} onClick={onConcluir} fullWidth>
                Concluir e gerar venda
              </Button>
              <p className="m-0 text-[11px] text-[var(--text-muted)] leading-relaxed">
                Marca como feito e lança a venda do serviço{valorConclusao} no caixa.
              </p>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={btnSec} onClick={onEditar} disabled={travado}>
              {emAberto
                ? <><CalendarClock size={14} aria-hidden="true" /> Remarcar</>
                : <><Edit2 size={14} aria-hidden="true" /> Editar</>}
            </button>
            {whats ? (
              <a href={whats} target="_blank" rel="noopener noreferrer" className={btnSec}>
                <MessageCircle size={14} aria-hidden="true" /> WhatsApp
              </a>
            ) : (
              <button type="button" className={btnSec} disabled title="Cliente sem telefone">
                <MessageCircle size={14} aria-hidden="true" /> WhatsApp
              </button>
            )}
            {emAberto && (
              <button type="button" className={`${btnSec} text-[var(--danger-text)]`} onClick={() => onStatus('CANCELED')}>
                <XCircle size={14} aria-hidden="true" /> Não compareceu
              </button>
            )}
            <button type="button" className={`${btnSec} text-[var(--danger-text)]`} onClick={onExcluir} disabled={travado}>
              <Trash2 size={14} aria-hidden="true" /> Excluir
            </button>
          </div>

          {ag.status === 'COMPLETED' && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--success-soft)] text-[var(--success-text)]">
              <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="m-0 text-xs leading-relaxed">
                <strong>Atendimento concluído.</strong> A venda do serviço foi lançada no caixa. Para reverter, cancele a venda em Vendas.
              </p>
            </div>
          )}

          {/* Controle manual de status (correções administrativas). Travado
              quando o item está imutável OU já concluído (tem venda). */}
          <div className="pt-1">
            <div className="text-xs font-medium text-[var(--text-muted)] mb-1.5" id="mudar-status-rotulo">Mudar status</div>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-labelledby="mudar-status-rotulo">
              {[
                ['CONFIRMED', 'Confirmar'],
                ['PENDING', 'Pendente'],
                ['CANCELED', 'Cancelar'],
              ].map(([s, rot]) => {
                const ativo = ag.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onStatus(s)}
                    disabled={travado || ag.status === 'COMPLETED'}
                    aria-pressed={ativo}
                    className={`h-8 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      ativo
                        ? 'bg-[var(--text-main)] text-[var(--bg-card)] border-[var(--text-main)]'
                        : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-main)] hover:bg-[var(--bg-subtle)]'
                    }`}
                  >
                    {rot}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Painel>

      {/* Histórico de alterações — sempre visível, até em itens travados. */}
      <Painel id="historico-horario" titulo="Histórico de alterações" semPadding acoes={<History size={14} className="text-[var(--text-muted)]" aria-hidden="true" />}>
        {carregandoHist ? (
          <div className="px-4 py-3 text-xs text-[var(--text-muted)]">Carregando…</div>
        ) : historico.length === 0 ? (
          <div className="px-4 py-3 text-xs text-[var(--text-muted)]">Sem alterações registradas.</div>
        ) : (
          <ul className="m-0 p-0 list-none">
            {historico.map((h) => <ItemHistorico key={h.id} item={h} />)}
          </ul>
        )}
      </Painel>
    </>
  );
}

const ACAO_CFG = {
  CRIADO:        { label: 'Criado',       cor: 'success' },
  EDITADO:       { label: 'Editado',      cor: 'info' },
  STATUS_MUDADO: { label: 'Mudou status', cor: 'warning' },
  EXCLUIDO:      { label: 'Excluído',     cor: 'danger' },
};

const CAMPOS_LABEL = {
  nomeCliente: 'Nome', telefoneCliente: 'Telefone', data: 'Data/hora',
  duracao: 'Duração', servico: 'Serviço', preco: 'Preço',
  observacoes: 'Obs.', status: 'Status',
};

function fmtValor(campo, v) {
  if (v == null || v === '') return '—';
  if (campo === 'data') return new Date(v).toLocaleString('pt-BR');
  if (campo === 'preco') return fmtBRL(v);
  if (campo === 'status') return STATUS_LABELS[v]?.label || v;
  return String(v);
}

function ItemHistorico({ item }) {
  const data = new Date(item.criadoEm);
  const cfg = ACAO_CFG[item.acao] || { label: item.acao, cor: 'neutral' };
  const quemFez = item.usuarioNome || (item.origem === 'AI' ? 'Bot' : 'Sistema');
  return (
    <li className="px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant={cfg.cor} size="sm">{cfg.label}</Badge>
          <span className="text-[11px] text-[var(--text-secondary)] font-medium truncate">{quemFez}</span>
        </div>
        <span className="text-[11px] text-[var(--text-muted)] tabular-nums flex-shrink-0">
          {data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} {fmtHora(data)}
        </span>
      </div>
      {item.alteracoes && <DiffAlteracoes alteracoes={item.alteracoes} />}
    </li>
  );
}

function DiffAlteracoes({ alteracoes }) {
  // Snapshot (CRIADO/EXCLUIDO): só mostra os valores, sem de→para.
  if (alteracoes.snapshot) {
    return (
      <div className="text-[11px] text-[var(--text-secondary)] space-y-0.5 mt-1">
        {Object.entries(alteracoes.snapshot)
          .filter(([, v]) => v != null && v !== '')
          .slice(0, 4)
          .map(([campo, v]) => (
            <div key={campo}>
              <span className="text-[var(--text-muted)]">{CAMPOS_LABEL[campo] || campo}:</span>{' '}
              <span className="font-medium">{fmtValor(campo, v)}</span>
            </div>
          ))}
      </div>
    );
  }
  // Diff (EDITADO/STATUS_MUDADO)
  return (
    <div className="text-[11px] space-y-0.5 mt-1">
      {Object.entries(alteracoes).map(([campo, { de, para }]) => (
        <div key={campo}>
          <span className="text-[var(--text-muted)]">{CAMPOS_LABEL[campo] || campo}:</span>{' '}
          <span className="text-[var(--text-secondary)] line-through opacity-70">{fmtValor(campo, de)}</span>
          {' → '}
          <span className="font-semibold text-[var(--text-main)]">{fmtValor(campo, para)}</span>
        </div>
      ))}
    </div>
  );
}

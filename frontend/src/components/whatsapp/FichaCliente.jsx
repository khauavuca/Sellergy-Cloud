import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { ArrowLeft, CalendarDays, UserPlus } from 'lucide-react';
import { Badge, IconButton, Painel, LinhaInfo } from '../ui';
import { formatarTelefone, hora, iniciais, moeda, nomeDaConversa } from './util';

// Link com cara de botão (sem <button> dentro de <a>).
function LinkBotao({ to, primario = false, icon: Icon, className, children }) {
  return (
    <Link
      to={to}
      className={clsx(
        'h-10 px-4 rounded-lg inline-flex items-center justify-center gap-2 text-sm font-semibold transition-colors no-underline',
        primario
          ? 'bg-[var(--primary)] text-[var(--text-on-primary)] hover:bg-[var(--primary-hover)]'
          : 'bg-[var(--bg-card)] text-[var(--text-main)] border border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]',
        className
      )}
    >
      {Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </Link>
  );
}

const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const dataHora = (iso) => (iso ? `${new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} · ${hora(iso)}` : null);

/** Coluna da direita: quem é o contato no CRM e o que o bot fez nesta conversa. */
export default function FichaCliente({ conversa, ficha, respostasDoBotHoje, modulos, onVoltar, className }) {
  if (!conversa) return null;
  const nome = nomeDaConversa(conversa);
  const agenda = modulos?.AGENDA === true;
  const vendas = modulos?.VENDAS === true;

  return (
    <aside aria-label="Ficha do cliente" className={clsx('min-w-0 flex flex-col gap-4 overflow-y-auto', className)}>
      <section className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)]">
        <div className="p-4 flex gap-3 items-center border-b border-[var(--border-subtle)]">
          <IconButton icon={ArrowLeft} ariaLabel="Voltar para a conversa" size="sm" className="xl:hidden -ml-1" onClick={onVoltar} />
          <span className="flex-none w-12 h-12 rounded-full grid place-items-center text-sm font-bold bg-[var(--accent-soft)] text-[var(--accent-text)]" aria-hidden="true">
            {iniciais(nome)}
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="m-0 text-base font-bold text-[var(--text-main)] truncate">{nome}</h2>
            <p className="m-0 text-xs text-[var(--text-muted)]">{formatarTelefone(conversa.telefone)}</p>
          </div>
          {ficha?.etapa?.nome && <Badge variant="info">{ficha.etapa.nome}</Badge>}
        </div>

        {ficha ? (
          <>
            <div className="grid grid-cols-3 border-b border-[var(--border-subtle)]">
              <div className="px-4 py-3 min-w-0">
                <div className="text-xs text-[var(--text-muted)]">Compras</div>
                <strong className="text-sm text-[var(--text-main)] tabular-nums">{ficha.compras}</strong>
              </div>
              <div className="px-4 py-3 border-l border-[var(--border-subtle)] min-w-0">
                <div className="text-xs text-[var(--text-muted)]">Total</div>
                <strong className="text-sm text-[var(--text-main)] tabular-nums truncate block">{moeda(ficha.totalGasto)}</strong>
              </div>
              <div className="px-4 py-3 border-l border-[var(--border-subtle)] min-w-0">
                <div className="text-xs text-[var(--text-muted)]">Última</div>
                <strong className="text-sm text-[var(--text-main)] tabular-nums">{ficha.ultimaCompra ? data(ficha.ultimaCompra.data).slice(0, 5) : '—'}</strong>
              </div>
            </div>
            {agenda && (
              <div className="px-4 py-3.5 border-b border-[var(--border-subtle)]">
                <div className="text-xs text-[var(--text-muted)] mb-1.5">Próximo horário</div>
                <div className="flex gap-2.5 items-center">
                  <span className="flex-none w-9 h-9 rounded-lg grid place-items-center bg-[var(--info-soft)] text-[var(--info-text)]" aria-hidden="true">
                    <CalendarDays size={18} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[var(--text-main)]">{dataHora(ficha.proximoHorario?.data) || 'Sem horário marcado'}</div>
                    {ficha.proximoHorario && (
                      <div className="text-xs text-[var(--text-muted)] truncate">
                        {[ficha.proximoHorario.servico, ficha.proximoHorario.especialista?.nome && `com ${ficha.proximoHorario.especialista.nome}`].filter(Boolean).join(' ')}
                        {ficha.proximoHorario.status === 'CONFIRMED' ? ' · confirmado' : ''}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="p-4 grid grid-cols-2 gap-2">
              {agenda && <LinkBotao to={`/app/agenda?${new URLSearchParams({ novo: '1', leadId: ficha.id, nome: ficha.nome || '', telefone: ficha.telefone || '' })}`} primario className="col-span-2">Agendar</LinkBotao>}
              <LinkBotao to={`/app/crm?lead=${ficha.id}`} className={clsx(!vendas && 'col-span-2')}>Ver ficha</LinkBotao>
              {vendas && <LinkBotao to={`/app/vendas?leadId=${ficha.id}`}>Nova venda</LinkBotao>}
            </div>
          </>
        ) : (
          <div className="p-4 flex flex-col gap-3 text-sm text-[var(--text-secondary)]">
            <p className="m-0">Este número ainda não está nos seus clientes. Cadastre para ver compras, horários e anotações aqui.</p>
            <LinkBotao to="/app/crm" icon={UserPlus}>Cadastrar em Clientes</LinkBotao>
          </div>
        )}
      </section>

      {ficha && (ficha.observacoes || ficha.email || ficha.dataNascimento || ficha.tags) && (
        <Painel titulo="Sobre o cliente" semPadding>
          {ficha.email && <LinhaInfo rotulo="E-mail" valor={ficha.email} />}
          {ficha.dataNascimento && <LinhaInfo rotulo="Aniversário" valor={new Date(ficha.dataNascimento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })} />}
          {ficha.tags && <LinhaInfo rotulo="Etiquetas" valor={ficha.tags} />}
          {ficha.observacoes && (
            <div className="px-4 py-3 text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              <div className="text-xs text-[var(--text-muted)] mb-1">Anotações</div>
              {ficha.observacoes}
            </div>
          )}
        </Painel>
      )}

      <Painel titulo="Bot nesta conversa" acoes={<Link to="/app/bots" className="text-xs font-semibold text-[var(--primary)]">Configurar</Link>} semPadding>
        <LinhaInfo rotulo="Respostas automáticas hoje" valor={respostasDoBotHoje ?? 0} />
        <LinhaInfo rotulo="Situação">
          <Badge size="sm" variant={conversa.pausaAtiva ? 'neutral' : 'info'}>
            {conversa.pausaAtiva ? (conversa.botPausadoAte ? `Pausado até ${hora(conversa.botPausadoAte)}` : 'Pausado até devolver') : 'Respondendo'}
          </Badge>
        </LinhaInfo>
        <LinhaInfo rotulo="Quando a equipe responde, o bot pausa por 4 horas nesta conversa." />
      </Painel>
    </aside>
  );
}

import clsx from 'clsx';
import { MessageCircle } from 'lucide-react';
import { Badge, SearchBar, Button } from '../ui';
import { FILTROS, SITUACOES, NOME_CANAL, horaCurta, iniciais, nomeDaConversa, formatarTelefone } from './util';

/** Coluna da esquerda: busca, filtros e a lista de conversas. */
export default function ListaConversas({
  conversas, contagens, carregando, temMais, carregandoMais, onMais,
  busca, onBusca, filtro, onFiltro, selecionadaId, onSelecionar, canal, className,
}) {
  return (
    <section
      aria-label="Lista de conversas"
      className={clsx('rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0 flex flex-col overflow-hidden', className)}
    >
      <div className="p-3 border-b border-[var(--border-subtle)] flex flex-col gap-2.5">
        <div role="search" aria-label="Buscar conversa">
          <SearchBar
            size="sm"
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="[&_input]:rounded-lg"
          />
        </div>
        <div role="tablist" aria-label="Filtrar conversas" className="flex flex-wrap gap-1">
          {FILTROS.map((f) => {
            const ativo = f.valor === filtro;
            return (
              <button
                key={f.valor}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => onFiltro(f.valor)}
                className={clsx(
                  'h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors',
                  ativo ? 'bg-[var(--text-main)] text-[var(--bg-card)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                )}
              >
                {f.rotulo}
                {contagens?.[f.valor] != null && <span className="opacity-70 tabular-nums">{contagens[f.valor]}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" aria-busy={carregando}>
        {carregando && !conversas.length ? (
          <div className="p-3 flex flex-col gap-3" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3 items-center">
                <div className="w-9 h-9 rounded-full bg-[var(--bg-subtle)] animate-pulse" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="h-3 w-2/3 rounded bg-[var(--bg-subtle)] animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-[var(--bg-subtle)] animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : !conversas.length ? (
          <div className="p-6 text-center text-sm text-[var(--text-muted)] flex flex-col items-center gap-2">
            <MessageCircle size={22} strokeWidth={1.5} aria-hidden="true" />
            {busca || filtro !== 'todas'
              ? 'Nenhuma conversa com esse filtro.'
              : 'Ainda não chegou nenhuma mensagem. Quando um cliente escrever no seu WhatsApp, a conversa aparece aqui.'}
          </div>
        ) : (
          <ul className="list-none m-0 p-0">
            {conversas.map((c) => {
              const nome = nomeDaConversa(c);
              const ativa = c.id === selecionadaId;
              const sit = SITUACOES[c.situacao] || SITUACOES.BOT;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelecionar(c.id)}
                    aria-current={ativa ? 'true' : undefined}
                    className={clsx(
                      'w-full flex gap-2.5 items-start px-3.5 py-3 border-b border-[var(--border-subtle)] text-left transition-colors',
                      ativa ? 'bg-[var(--primary-soft)] shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-[var(--bg-subtle)]'
                    )}
                  >
                    <span className="flex-none w-9 h-9 rounded-full grid place-items-center text-xs font-bold bg-[var(--accent-soft)] text-[var(--accent-text)]" aria-hidden="true">
                      {iniciais(nome)}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="flex items-baseline gap-2">
                        <strong className="flex-1 min-w-0 truncate text-[13px] text-[var(--text-main)]">{nome}</strong>
                        <span className="text-xs text-[var(--text-muted)] flex-none">{horaCurta(c.ultimaMensagemEm)}</span>
                      </span>
                      <span className="text-xs text-[var(--text-muted)] truncate">
                        {c.ultimaMensagemOrigem && c.ultimaMensagemOrigem !== 'CONTATO' ? 'Você: ' : ''}
                        {c.ultimaMensagemTexto || formatarTelefone(c.telefone)}
                      </span>
                      <span className="flex items-center gap-1.5 mt-0.5">
                        <Badge size="sm" variant={sit.variant}>{sit.rotulo}</Badge>
                        {c.canal && <span className="text-[11px] text-[var(--text-muted)]">{c.canal === 'BAILEYS' ? 'QR Code' : 'Oficial'}</span>}
                      </span>
                    </span>
                    {c.naoLidas > 0 && !ativa && (
                      <span className="flex-none min-w-5 h-5 px-1.5 rounded-full bg-[var(--primary)] text-[var(--text-on-primary)] text-[11px] font-bold grid place-items-center tabular-nums">
                        <span className="sr-only">Não lidas: </span>{c.naoLidas}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {temMais && (
          <div className="p-3 flex justify-center">
            <Button size="sm" variant="ghost" loading={carregandoMais} onClick={onMais}>Carregar mais</Button>
          </div>
        )}
      </div>

      {canal?.conectado && (
        <div className="px-3.5 py-2.5 border-t border-[var(--border-subtle)] flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="w-2 h-2 rounded-full bg-[var(--success)]" aria-hidden="true" />
          <span className="truncate">
            {NOME_CANAL[canal.provedor] ? NOME_CANAL[canal.provedor][0].toUpperCase() + NOME_CANAL[canal.provedor].slice(1) : 'Conectado'}
            {canal.numero ? ` · ${formatarTelefone(canal.numero)}` : ''}
          </span>
          {!canal.envioReal && <Badge size="sm" variant="warning" className="ml-auto">Envio simulado</Badge>}
        </div>
      )}
    </section>
  );
}

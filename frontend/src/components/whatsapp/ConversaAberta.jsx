import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowLeft, Bot, Send, ShieldCheck, UserRound, Hand, Undo2, AlertTriangle } from 'lucide-react';
import { Badge, Button, IconButton, Dropdown, DropdownItem } from '../ui';
import AtalhosResposta from './AtalhosResposta';
import {
  ROTULO_ORIGEM, ROTULO_STATUS, NOME_CANAL, chaveDia, formatarTelefone, hora, iniciais, nomeDaConversa, rotuloDia,
} from './util';

const LIMITE = 4096;

function Bolha({ m }) {
  const entrada = m.direcao === 'ENTRADA';
  const automatica = !entrada && m.origem !== 'EQUIPE';
  return (
    <div
      className={clsx(
        'max-w-[85%] sm:max-w-[72%] px-3 pt-2 pb-1.5 rounded-[10px] text-[13px] leading-relaxed text-[var(--text-main)] min-w-0',
        entrada && 'self-start bg-[var(--bg-card)] border border-[var(--border-main)] rounded-tl-sm',
        !entrada && !automatica && 'self-end bg-[var(--success-soft)] rounded-tr-sm',
        automatica && 'self-end bg-[var(--info-soft)] border border-dashed border-[var(--info)] rounded-tr-sm',
        m.status === 'FALHOU' && 'ring-1 ring-[var(--danger)]'
      )}
    >
      {automatica && (
        <span className="flex items-center gap-1 text-[11px] font-bold text-[var(--info-text)] mb-0.5">
          <Bot size={12} aria-hidden="true" />
          {ROTULO_ORIGEM[m.origem] || 'Automática'}
        </span>
      )}
      {!entrada && m.origem === 'EQUIPE' && m.autorNome && (
        <span className="block text-[11px] font-bold text-[var(--success-text)] mb-0.5">{m.autorNome}</span>
      )}
      <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.texto}</div>
      <span className="flex justify-end gap-1.5 items-center text-[11px] text-[var(--text-muted)] mt-1">
        {ROTULO_STATUS[m.status] && (
          <span className={clsx(m.status === 'FALHOU' && 'text-[var(--danger-text)] font-semibold')} title={m.erro || undefined}>
            {ROTULO_STATUS[m.status]}
          </span>
        )}
        <time dateTime={m.criadoEm}>{hora(m.criadoEm)}</time>
      </span>
    </div>
  );
}

/** Aviso sob o campo: janela de 24 h do oficial, envio simulado, desconectado. */
function avisoEnvio({ canal, conversa }) {
  if (!canal?.conectado) return { tom: 'perigo', texto: 'WhatsApp desconectado. Conecte em "Bots e conexão" para responder.' };
  if (!canal.envioReal) return { tom: 'alerta', texto: 'Envio simulado neste ambiente: a resposta fica gravada aqui, mas não sai para o cliente.' };
  if (canal.provedor === 'META_CLOUD') {
    if (!conversa?.janelaAte || new Date(conversa.janelaAte) < new Date()) {
      return { tom: 'alerta', texto: 'WhatsApp oficial: passou de 24 h da última mensagem do cliente. Só dá para mandar modelo aprovado (campanha).' };
    }
    return { tom: 'neutro', texto: `WhatsApp oficial: conversa aberta até ${hora(conversa.janelaAte)}. Depois disso, só modelo aprovado.` };
  }
  return { tom: 'neutro', texto: 'Número por QR Code: o envio é espaçado para proteger o chip.' };
}

export default function ConversaAberta({
  conversa, canal, atalhos, mensagens, carregando, temMais, carregandoMais, onMais,
  onEnviar, onPausar, onRetomar, onVoltar, onFicha, podeResponder, className,
}) {
  const [rascunho, setRascunho] = useState('');
  const [enviando, setEnviando] = useState(false);
  const rolagem = useRef(null);
  const campo = useRef(null);
  const ultimaId = mensagens[mensagens.length - 1]?.id;
  const primeiraId = mensagens[0]?.id;
  const alturaAntes = useRef(null);

  // Troca de conversa: limpa o rascunho e o foco vai pro campo.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset ao trocar de conversa
    setRascunho('');
  }, [conversa?.id]);

  // Mensagem nova no fim: desce. Página antiga carregada no topo: mantém a posição.
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    if (alturaAntes.current != null) {
      el.scrollTop = el.scrollHeight - alturaAntes.current;
      alturaAntes.current = null;
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [ultimaId, primeiraId, conversa?.id]);

  const carregarAntigas = () => {
    alturaAntes.current = rolagem.current ? rolagem.current.scrollHeight - rolagem.current.scrollTop : null;
    onMais();
  };

  const aviso = avisoEnvio({ canal, conversa });
  const bloqueado = !podeResponder || !canal?.conectado
    || (canal?.provedor === 'META_CLOUD' && canal?.envioReal && (!conversa?.janelaAte || new Date(conversa.janelaAte) < new Date()));

  const enviar = async () => {
    const texto = rascunho.trim();
    if (!texto || enviando || bloqueado) return;
    setEnviando(true);
    const ok = await onEnviar(texto);
    setEnviando(false);
    if (ok) setRascunho('');
    campo.current?.focus();
  };

  const inserir = (texto) => {
    setRascunho((r) => (r.trim() ? `${r.trimEnd()}\n${texto}` : texto));
    setTimeout(() => campo.current?.focus(), 0);
  };

  if (!conversa) {
    return (
      <section aria-label="Conversa aberta" className={clsx('rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0 grid place-items-center p-8 text-center text-sm text-[var(--text-muted)]', className)}>
        <div className="flex flex-col items-center gap-2">
          <UserRound size={24} strokeWidth={1.5} aria-hidden="true" />
          Escolha uma conversa na lista para ler e responder.
        </div>
      </section>
    );
  }

  const nome = nomeDaConversa(conversa);
  const pausada = conversa.pausaAtiva;

  // Separadores de dia entre as mensagens.
  const itens = [];
  let diaAnterior = null;
  for (const m of mensagens) {
    const d = chaveDia(m.criadoEm);
    if (d !== diaAnterior) itens.push({ dia: rotuloDia(m.criadoEm), chave: `dia-${d}` });
    itens.push({ m });
    diaAnterior = d;
  }

  return (
    <section aria-label={`Conversa com ${nome}`} className={clsx('rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] min-w-0 flex flex-col overflow-hidden', className)}>
      <header className="px-3 sm:px-4 py-3 border-b border-[var(--border-subtle)] flex flex-wrap items-center gap-x-3 gap-y-2">
        <IconButton icon={ArrowLeft} ariaLabel="Voltar para a lista" size="sm" className="lg:hidden" onClick={onVoltar} />
        <span className="flex-none w-9 h-9 rounded-full grid place-items-center text-xs font-bold bg-[var(--accent-soft)] text-[var(--accent-text)]" aria-hidden="true">
          {iniciais(nome)}
        </span>
        <div className="flex-1 min-w-[140px]">
          <h2 className="m-0 text-[15px] font-bold text-[var(--text-main)] truncate">{nome}</h2>
          <p className="m-0 text-xs text-[var(--text-muted)] truncate">
            {formatarTelefone(conversa.telefone)}
            {conversa.canal ? ` · chegou pelo ${NOME_CANAL[conversa.canal] || 'WhatsApp'}` : ''}
          </p>
        </div>
        <Badge variant={pausada ? 'neutral' : 'info'} icon={pausada ? UserRound : Bot}>
          {pausada ? (conversa.botPausadoAte ? `Com a equipe até ${hora(conversa.botPausadoAte)}` : 'Com a equipe') : 'Bot respondendo'}
        </Badge>
        {podeResponder && (pausada ? (
          <Button size="sm" variant="secondary" icon={Undo2} onClick={onRetomar}>Devolver ao bot</Button>
        ) : (
          <Dropdown
            align="right"
            trigger={<Button size="sm" variant="secondary" icon={Hand}>Assumir conversa</Button>}
          >
            <DropdownItem onClick={() => onPausar(4)}>Por 4 horas</DropdownItem>
            <DropdownItem onClick={() => onPausar(24)}>Até amanhã (24 h)</DropdownItem>
            <DropdownItem onClick={() => onPausar(null)}>Até eu devolver ao bot</DropdownItem>
          </Dropdown>
        ))}
        <Button size="sm" variant="ghost" className="xl:hidden" onClick={onFicha}>Ficha</Button>
      </header>

      <div ref={rolagem} className="flex-1 min-h-0 overflow-y-auto bg-[var(--bg-app)] p-3 sm:p-4 flex flex-col gap-2" aria-live="polite" aria-busy={carregando}>
        {temMais && (
          <div className="self-center">
            <Button size="sm" variant="ghost" loading={carregandoMais} onClick={carregarAntigas}>Mensagens anteriores</Button>
          </div>
        )}
        {carregando && !mensagens.length && (
          <p className="self-center text-xs text-[var(--text-muted)]">Carregando mensagens…</p>
        )}
        {itens.map((it) => (it.dia ? (
          <div key={it.chave} className="self-center text-[11px] font-semibold text-[var(--text-secondary)] bg-[var(--bg-card)] border border-[var(--border-main)] rounded-[10px] px-2.5 py-0.5">
            {it.dia}
          </div>
        ) : <Bolha key={it.m.id} m={it.m} />))}
      </div>

      <div className="border-t border-[var(--border-subtle)] px-3 sm:px-4 py-3 flex flex-col gap-2.5">
        {podeResponder && <AtalhosResposta atalhos={atalhos} conversa={conversa} onInserir={inserir} desabilitado={bloqueado} />}
        {podeResponder ? (
          <form
            className="flex gap-2 items-end"
            onSubmit={(e) => { e.preventDefault(); enviar(); }}
          >
            <label htmlFor="resposta-whatsapp" className="sr-only">Mensagem para {nome}</label>
            <textarea
              id="resposta-whatsapp"
              ref={campo}
              rows={1}
              value={rascunho}
              maxLength={LIMITE}
              disabled={bloqueado}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); }
              }}
              placeholder={bloqueado ? 'Responder está indisponível agora' : 'Escreva uma mensagem (Enter envia, Shift+Enter quebra linha)'}
              className="flex-1 min-w-0 min-h-10 max-h-40 resize-none field-sizing-content px-3 py-2 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--primary)] focus:shadow-[var(--shadow-focus)] disabled:opacity-60"
            />
            <Button type="submit" icon={Send} loading={enviando} disabled={!rascunho.trim() || bloqueado}>
              <span className="max-sm:sr-only">Enviar</span>
            </Button>
          </form>
        ) : (
          <p className="m-0 text-xs text-[var(--text-muted)]">Você pode ler as conversas, mas responder precisa da permissão de editar Clientes.</p>
        )}
        <div className={clsx(
          'flex gap-2 items-start text-xs',
          aviso.tom === 'perigo' && 'text-[var(--danger-text)]',
          aviso.tom === 'alerta' && 'text-[var(--warning-text)]',
          aviso.tom === 'neutro' && 'text-[var(--text-muted)]'
        )}>
          {aviso.tom === 'neutro' ? <ShieldCheck size={14} className="flex-none mt-px" aria-hidden="true" /> : <AlertTriangle size={14} className="flex-none mt-px" aria-hidden="true" />}
          <span>{aviso.texto}</span>
          {rascunho.length > LIMITE * 0.8 && <span className="ml-auto tabular-nums">{rascunho.length}/{LIMITE}</span>}
        </div>
      </div>
    </section>
  );
}

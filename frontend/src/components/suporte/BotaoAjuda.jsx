// Chat do suporte do lado do cliente: botao redondo no canto que abre uma
// janela flutuante (como um app de mensagem). Inicio com o passo a passo da
// tela atual + conversas; conversa em baloes, com foto temporaria.
// Rotas: /suporte/chamados (lista, abrir, responder, fotos, avaliar).
// A notificacao de resposta leva pra ?ajuda=<chamadoId> e abre direto na
// conversa. Na sessao de suporte (so leitura) da pra ver, nao escrever.
//
// Fotos: somem quando o chamado e resolvido; a conversa fica guardada por
// 7 dias depois disso e entao e apagada (regra em backend/src/suporte/anexos.js).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, BookOpen, ChevronDown, ExternalLink, ImagePlus, MessageCircle, Star, X } from 'lucide-react';
import clsx from 'clsx';
import api from '../../services/api';
import { useAuthStore } from '../../store/auth.store';
import { useToast } from '../ui';
import { linkAjuda } from '../../utils/ajuda';

const STATUS = {
  ABERTO: { rotulo: 'Aguardando o suporte', classe: 'bg-[var(--warning-soft)] text-[var(--warning-text)]' },
  RESPONDIDO: { rotulo: 'Respondido', classe: 'bg-[var(--primary-soft)] text-[var(--primary)]' },
  RESOLVIDO: { rotulo: 'Resolvido', classe: 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]' },
};

const CATEGORIAS = [
  ['DUVIDA', 'Dúvida de uso'],
  ['ERRO', 'Algo deu erro'],
  ['FISCAL', 'Nota fiscal'],
  ['COBRANCA', 'Cobrança e plano'],
  ['WHATSAPP', 'WhatsApp'],
  ['OUTRO', 'Outro assunto'],
];

const TIPOS_FOTO = 'image/jpeg,image/png,image/webp';
const MAX_FOTO = 5 * 1024 * 1024;
const urlApi = (caminho) => `${api.defaults.baseURL}${caminho}`;

function hora(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function dia(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
function iniciais(nome) {
  return String(nome || 'S').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

// Escolha de foto validada no navegador (o servidor confere de novo).
function useFoto() {
  const toast = useToast();
  const [foto, setFoto] = useState(null);
  const escolher = (arquivo) => {
    if (!arquivo) return;
    if (!TIPOS_FOTO.split(',').includes(arquivo.type)) { toast.error('Mande uma foto em JPG, PNG ou WEBP.'); return; }
    if (arquivo.size > MAX_FOTO) { toast.error('A foto passa de 5 MB. Tire um print menor.'); return; }
    setFoto({ arquivo, previa: URL.createObjectURL(arquivo) });
  };
  const limpar = () => { setFoto((f) => { if (f) URL.revokeObjectURL(f.previa); return null; }); };
  return { foto, escolher, limpar };
}

// Campo de mensagem: pilula com clipe, texto que cresce e botao redondo.
function CampoMensagem({ placeholder, enviando, onEnviar, rodape }) {
  const [texto, setTexto] = useState('');
  const { foto, escolher, limpar } = useFoto();
  const entrada = useRef(null);
  const arquivo = useRef(null);

  useEffect(() => {
    const el = entrada.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [texto]);

  const enviar = async () => {
    if (enviando || (!texto.trim() && !foto)) return;
    const ok = await onEnviar({ texto: texto.trim(), foto: foto?.arquivo || null });
    if (ok) { setTexto(''); limpar(); }
  };

  return (
    <div className="px-2.5 pt-2 pb-2 border-t border-[var(--border-main)] bg-[var(--bg-card)]">
      {foto && (
        <div className="mb-2 ml-1 relative inline-block">
          <img src={foto.previa} alt="Foto escolhida" className="h-14 w-14 object-cover rounded-xl border border-[var(--border-main)]" />
          <button type="button" onClick={limpar} aria-label="Tirar a foto"
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[var(--text-main)] text-[var(--bg-card)] grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
            <X size={13} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1 p-1 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-subtle)] focus-within:border-[var(--primary)]">
        <button type="button" onClick={() => arquivo.current?.click()} aria-label="Anexar foto"
          className="w-7 h-7 shrink-0 rounded-full grid place-items-center text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
          <ImagePlus size={15} />
        </button>
        <input ref={arquivo} type="file" accept={TIPOS_FOTO} className="hidden" tabIndex={-1}
          onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = ''; }} />
        <label className="sr-only" htmlFor="ajuda-mensagem">Mensagem</label>
        <textarea id="ajuda-mensagem" ref={entrada} rows={1} value={texto} maxLength={4000}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          placeholder={placeholder}
          className="flex-1 min-w-0 resize-none bg-transparent py-1.5 px-1 text-[13.5px] leading-snug text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none" />
        <button type="button" onClick={enviar} disabled={enviando || (!texto.trim() && !foto)} aria-label="Enviar"
          className="w-7 h-7 shrink-0 rounded-full grid place-items-center bg-[var(--primary)] text-[var(--text-on-primary)] disabled:opacity-40 hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--primary)]">
          {enviando ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <ArrowUp size={14} strokeWidth={2.6} />}
        </button>
      </div>
      {rodape && <p className="mt-1 text-center text-[10.5px] text-[var(--text-muted)]">{rodape}</p>}
    </div>
  );
}

function Inicio({ nome, chamados, erro, carregando, onAbrir, onNovo, onTentar, somenteLeitura, linkTela }) {
  return (
    <div className="flex-1 overflow-y-auto px-3 py-3.5 space-y-3.5">
      <div>
        <p className="font-['Space_Grotesk',Inter,sans-serif] text-lg font-bold tracking-tight text-[var(--text-main)]">Oi{nome ? `, ${nome}` : ''}!</p>
        <p className="text-[13px] text-[var(--text-muted)]">Como podemos ajudar hoje?</p>
      </div>

      <a href={linkTela} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-2.5 p-2.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] no-underline hover:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
        <span className="w-7 h-7 rounded-lg bg-[var(--primary-soft)] text-[var(--primary)] grid place-items-center shrink-0"><BookOpen size={15} /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold text-[var(--text-main)]">Passo a passo desta tela</span>
          <span className="block text-xs text-[var(--text-muted)]">Na Central de Ajuda</span>
        </span>
        <ExternalLink size={13} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
      </a>

      {!somenteLeitura && (
        <button type="button" onClick={onNovo}
          className="w-full min-h-10 rounded-xl bg-[var(--primary)] text-[var(--text-on-primary)] font-semibold text-[13px] inline-flex items-center justify-center gap-2 hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--primary)]">
          <MessageCircle size={15} /> Falar com o suporte
        </button>
      )}

      <div>
        <p className="text-[11px] font-bold tracking-wider text-[var(--text-muted)] mb-1.5">SUAS CONVERSAS</p>
        {erro ? (
          <div role="alert" className="text-sm text-[var(--danger-text)] space-y-2">
            <p>{erro}</p>
            <button type="button" onClick={onTentar} className="underline font-semibold">Tentar de novo</button>
          </div>
        ) : carregando && !chamados ? (
          <div className="space-y-2" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-16 rounded-2xl bg-[var(--bg-subtle)] animate-pulse" />)}</div>
        ) : (chamados || []).length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nenhuma conversa ainda. Quando você falar com a gente, ela aparece aqui.</p>
        ) : (
          <ul className="space-y-1.5">
            {chamados.map((c) => {
              const novo = c.status === 'RESPONDIDO' && c.ultimaMensagem?.autor === 'SUPORTE';
              const resolvido = c.status === 'RESOLVIDO';
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => onAbrir(c.id)}
                    className={clsx('w-full text-left flex items-center gap-2.5 p-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
                      resolvido ? 'hover:bg-[var(--bg-subtle)]' : 'border border-[var(--border-main)] bg-[var(--bg-card)] hover:border-[var(--primary)]')}>
                    <span className={clsx('w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold shrink-0',
                      resolvido ? 'bg-[var(--bg-subtle)] text-[var(--text-muted)]' : 'bg-[var(--primary)] text-[var(--text-on-primary)]')}>
                      {resolvido ? '✓' : 'S'}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex justify-between gap-2 text-[12.5px]">
                        <b className={clsx('truncate', resolvido ? 'text-[var(--text-secondary)]' : 'text-[var(--text-main)]')}>{c.assunto}</b>
                        <span className="text-[var(--text-muted)] whitespace-nowrap">{hora(c.atualizadoEm)}</span>
                      </span>
                      <span className="block text-xs text-[var(--text-muted)] truncate">
                        {resolvido ? 'Resolvido' : c.ultimaMensagem
                          ? `${c.ultimaMensagem.autor === 'SUPORTE' ? 'Suporte: ' : 'Você: '}${c.ultimaMensagem.texto || 'enviou uma foto'}`
                          : (STATUS[c.status] || {}).rotulo}
                      </span>
                    </span>
                    {novo && <span className="w-2 h-2 rounded-full bg-[var(--primary)] shrink-0" aria-label="resposta nova" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Novo({ onCriado }) {
  const toast = useToast();
  const [categoria, setCategoria] = useState('DUVIDA');
  const [assunto, setAssunto] = useState('');
  const [campos, setCampos] = useState([]);
  const [enviando, setEnviando] = useState(false);

  // A primeira mensagem (e a foto, se tiver) vai pelo mesmo campo do chat.
  const enviar = async ({ texto, foto }) => {
    if (!texto && !foto) return false;
    setEnviando(true);
    try {
      const r = await api.post('/suporte/chamados', { assunto: assunto.trim(), texto: texto || 'Enviei uma foto.', categoria });
      if (foto) {
        const f = new FormData();
        f.append('imagem', foto);
        await api.post(`/suporte/chamados/${r.data.id}/fotos`, f).catch(() => toast.error('O chamado abriu, mas a foto não foi. Tente mandar de novo na conversa.'));
      }
      onCriado(r.data.id);
      return true;
    } catch (err) {
      setCampos(err.response?.data?.campos || []);
      toast.error(err.response?.data?.erro || 'Não foi possível abrir o chamado.');
      return false;
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-3.5 space-y-3.5">
        <fieldset>
          <legend className="text-sm font-semibold text-[var(--text-main)] mb-2">Sobre o quê?</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIAS.map(([v, r]) => (
              <label key={v} className={clsx('min-h-8 px-2.5 inline-flex items-center rounded-full border text-xs cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--primary)]',
                categoria === v ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)] font-semibold' : 'border-[var(--border-main)] text-[var(--text-secondary)]')}>
                <input type="radio" name="categoria-ajuda" value={v} checked={categoria === v} onChange={() => setCategoria(v)} className="sr-only" />
                {r}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="ajuda-assunto" className="block text-sm font-semibold text-[var(--text-main)] mb-1.5">Assunto</label>
          <input id="ajuda-assunto" value={assunto} maxLength={120} onChange={(e) => setAssunto(e.target.value)}
            placeholder="Ex.: o lembrete não chegou pra uma cliente"
            aria-invalid={campos.includes('assunto') || undefined}
            className={clsx('w-full min-h-9 px-3 rounded-lg border bg-[var(--bg-card)] text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--primary)]',
              campos.includes('assunto') ? 'border-[var(--danger)]' : 'border-[var(--border-main)]')} />
          {campos.includes('assunto') && <p className="text-xs text-[var(--danger-text)] mt-1">Escreva o assunto (3 a 120 letras).</p>}
        </div>
        <p className="text-[13px] text-[var(--text-muted)]">Conte embaixo o que aconteceu. Se puder, mande um print: ajuda muito.</p>
      </div>
      <CampoMensagem placeholder="O que aconteceu?" enviando={enviando} onEnviar={enviar}
        rodape="Fotos ficam só até o chamado ser resolvido." />
    </>
  );
}

// Pesquisa de satisfacao: nota de 0 a 5 em estrelas + relato.
function Estrelas({ nota, onEscolher, tamanho = 22 }) {
  return (
    <div className="flex items-center justify-center gap-0.5" role="radiogroup" aria-label="Nota do atendimento, de 0 a 5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={nota === n} aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
          onClick={() => onEscolher(nota === n ? n - 1 : n)}
          className="p-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
          <Star size={tamanho} className={n <= nota ? 'fill-[#F2B53C] text-[#F2B53C]' : 'text-[var(--border-strong)]'} />
        </button>
      ))}
    </div>
  );
}

const ROTULO_NOTA = ['Muito ruim', 'Ruim', 'Regular', 'Bom', 'Muito bom', 'Excelente'];

function Avaliar({ chamadoId, onAvaliado }) {
  const toast = useToast();
  const [nota, setNota] = useState(null);
  const [relato, setRelato] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    if (nota == null) return;
    setEnviando(true);
    try {
      await api.post(`/suporte/chamados/${chamadoId}/avaliar`, { nota, comentario: relato.trim() || undefined });
      toast.success('Obrigado pela avaliação!');
      onAvaliado();
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Não foi possível enviar a avaliação.');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="mx-auto my-3 w-full max-w-[280px] rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] p-3 text-center space-y-2">
      <p className="text-[13px] font-semibold text-[var(--text-main)]">Como foi o atendimento?</p>
      <Estrelas nota={nota ?? 0} onEscolher={setNota} />
      <p className="text-[11px] text-[var(--text-muted)] h-4">
        {nota == null ? 'Toque nas estrelas (pode ser 0)' : `${nota} de 5 · ${ROTULO_NOTA[nota]}`}
      </p>
      {nota == null && (
        <button type="button" onClick={() => setNota(0)} className="text-[11px] underline text-[var(--text-muted)]">Dar nota 0</button>
      )}
      <label className="sr-only" htmlFor="ajuda-relato">Conte como foi</label>
      <textarea id="ajuda-relato" rows={2} maxLength={500} value={relato} onChange={(e) => setRelato(e.target.value)}
        placeholder="Conte como foi o atendimento"
        className="w-full px-2.5 py-2 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] text-[13px] text-[var(--text-main)] resize-none focus:outline-none focus:border-[var(--primary)]" />
      <button type="button" onClick={enviar} disabled={enviando || nota == null}
        className="w-full min-h-9 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-[13px] font-semibold disabled:opacity-40">Enviar avaliação</button>
    </div>
  );
}

function Conversa({ chamadoId, somenteLeitura, onAtualizarTitulo }) {
  const toast = useToast();
  const [chamado, setChamado] = useState(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fim = useRef(null);

  const carregar = useCallback(() => api.get(`/suporte/chamados/${chamadoId}`)
    .then((r) => { setChamado(r.data); setErro(''); onAtualizarTitulo?.(r.data.assunto); })
    .catch((e) => setErro(e.response?.data?.erro || 'Não foi possível abrir a conversa.')), [chamadoId, onAtualizarTitulo]);

  useEffect(() => { carregar(); }, [carregar]);
  // Enquanto a conversa esta aberta, busca resposta nova a cada 15 s.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 15_000);
    return () => clearInterval(t);
  }, [carregar]);
  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); }, [chamado?.mensagens?.length]);

  const enviar = async ({ texto, foto }) => {
    setEnviando(true);
    try {
      if (foto) {
        const f = new FormData();
        f.append('imagem', foto);
        if (texto) f.append('texto', texto);
        await api.post(`/suporte/chamados/${chamadoId}/fotos`, f);
      } else {
        await api.post(`/suporte/chamados/${chamadoId}/mensagens`, { texto });
      }
      await carregar();
      return true;
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível enviar.');
      return false;
    } finally {
      setEnviando(false);
    }
  };

  // Mensagens agrupadas por dia (separador "Hoje", "Ontem"...).
  const grupos = useMemo(() => {
    const lista = [];
    for (const m of chamado?.mensagens || []) {
      const d = dia(m.criadoEm);
      if (!lista.length || lista[lista.length - 1].dia !== d) lista.push({ dia: d, itens: [] });
      lista[lista.length - 1].itens.push(m);
    }
    return lista;
  }, [chamado]);

  if (erro) {
    return (
      <div role="alert" className="flex-1 p-5 text-sm text-[var(--danger-text)] space-y-2">
        <p>{erro}</p>
        <button type="button" onClick={carregar} className="underline font-semibold">Tentar de novo</button>
      </div>
    );
  }
  if (!chamado) return <div className="flex-1 p-5"><div className="h-40 rounded-2xl bg-[var(--bg-subtle)] animate-pulse" aria-busy="true" /></div>;

  const st = STATUS[chamado.status] || { rotulo: chamado.status, classe: '' };
  const resolvido = chamado.status === 'RESOLVIDO';
  const apagada = Boolean(chamado.conversaApagadaEm);
  const guardaAte = chamado.resolvidoEm
    ? new Date(new Date(chamado.resolvidoEm).getTime() + (chamado.diasGuarda || 7) * 864e5).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : null;

  return (
    <>
      <div className="px-3 py-2 flex items-center gap-2 text-xs border-b border-[var(--border-main)] bg-[var(--bg-subtle)]">
        <b className="truncate text-[var(--text-main)]">{chamado.assunto}</b>
        <span className={clsx('px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap', st.classe)}>{st.rotulo}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 bg-[var(--bg-app)]">
        {apagada ? (
          <p className="text-center text-sm text-[var(--text-muted)] mt-8">Esta conversa foi encerrada e apagada. Se precisar, abra um chamado novo.</p>
        ) : (
          <ol className="space-y-1" aria-label="Conversa com o suporte">
            {grupos.map((g) => (
              <li key={g.dia}>
                <p className="mx-auto my-3 w-fit px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[11px] font-semibold text-[var(--text-muted)]">{g.dia}</p>
                <ol className="space-y-2.5">
                  {g.itens.map((m) => {
                    const minha = m.autor === 'CLIENTE';
                    return (
                      <li key={m.id} className={clsx('flex gap-2', minha ? 'justify-end' : 'items-end')}>
                        {!minha && (
                          <span aria-hidden="true" className="w-6 h-6 rounded-full bg-[var(--primary)] text-[var(--text-on-primary)] grid place-items-center text-[9px] font-bold shrink-0">{iniciais(m.autorNome)}</span>
                        )}
                        <div className={clsx('max-w-[78%] flex flex-col gap-1', minha ? 'items-end' : 'items-start')}>
                          {!minha && <span className="text-[11px] text-[var(--text-muted)] pl-1">{m.autorNome} · Suporte</span>}
                          {m.anexo?.caminho && (
                            <a href={urlApi(m.anexo.caminho)} target="_blank" rel="noopener noreferrer" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded-2xl">
                              <img src={urlApi(m.anexo.caminho)} alt={minha ? 'Foto que você enviou' : 'Foto enviada pelo suporte'} loading="lazy"
                                className="max-h-44 max-w-full rounded-xl border border-[var(--border-main)] object-cover" />
                            </a>
                          )}
                          {m.anexo?.apagado && (
                            <span className="px-3 py-2 rounded-2xl border border-dashed border-[var(--border-strong)] text-xs text-[var(--text-muted)]">Foto apagada quando o chamado foi resolvido</span>
                          )}
                          {m.texto && (
                            <p className={clsx('px-3 py-2 text-[13.5px] leading-snug whitespace-pre-wrap break-words',
                              minha ? 'bg-[var(--primary)] text-[var(--text-on-primary)] rounded-[18px_18px_4px_18px]' : 'bg-[var(--bg-card)] border border-[var(--border-main)] text-[var(--text-main)] rounded-[18px_18px_18px_4px]')}>
                              {m.texto}
                            </p>
                          )}
                          <span className="text-[11px] text-[var(--text-muted)] px-1">{hora(m.criadoEm)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        )}
        {resolvido && !apagada && (
          <p className="mx-auto mt-4 max-w-[300px] text-center text-[12px] text-[var(--text-muted)]">
            Chamado resolvido. As fotos já foram apagadas{guardaAte ? ` e a conversa fica guardada até ${guardaAte}` : ''}.
          </p>
        )}
        {resolvido && !apagada && !somenteLeitura && chamado.avaliacao == null && <Avaliar chamadoId={chamado.id} onAvaliado={carregar} />}
        {chamado.avaliacao != null ? <div className="mt-2 flex flex-col items-center gap-1 text-xs text-[var(--text-muted)]"><Estrelas nota={chamado.avaliacao} onEscolher={() => {}} tamanho={14} /><span>Você avaliou com {chamado.avaliacao} de 5. Obrigado!</span></div> : null}
        <div ref={fim} />
      </div>

      {!somenteLeitura && !apagada && (
        <CampoMensagem
          placeholder={resolvido ? 'Escrever de novo reabre o chamado' : 'Escreva uma mensagem...'}
          enviando={enviando} onEnviar={enviar}
          rodape="Fechar a janela não encerra o chamado. Só a equipe encerra." />
      )}
    </>
  );
}

export default function BotaoAjuda() {
  const somenteLeitura = useAuthStore((s) => Boolean(s.user?.suporte));
  const nome = useAuthStore((s) => String(s.user?.nome || '').split(' ')[0]);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const chamadoDaUrl = params.get('ajuda');
  const [aberto, setAberto] = useState(false);
  const [tela, setTela] = useState({ tipo: 'inicio' });
  const [chamados, setChamados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(() => api.get('/suporte/chamados')
    .then((r) => { setChamados(Array.isArray(r.data) ? r.data : []); setErro(''); })
    .catch((e) => setErro(e.response?.data?.erro || 'Não foi possível carregar suas conversas.'))
    .finally(() => setCarregando(false)), []);

  // Link da notificacao (?ajuda=<id>) abre direto na conversa.
  const painelAberto = aberto || Boolean(chamadoDaUrl);
  const telaAtual = chamadoDaUrl ? { tipo: 'conversa', id: chamadoDaUrl } : tela;

  useEffect(() => {
    if (!painelAberto) return undefined;
    const aoTeclar = (e) => { if (e.key === 'Escape') fechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  });

  const naTelaDoWhatsapp = location.pathname.startsWith('/app/whatsapp');
  const tirarDaUrl = () => { if (chamadoDaUrl) { params.delete('ajuda'); setParams(params, { replace: true }); } };
  const irInicio = () => { tirarDaUrl(); setAberto(true); setTela({ tipo: 'inicio' }); setCarregando(true); carregar(); };
  const alternar = () => { if (painelAberto) fechar(); else irInicio(); };
  function fechar() { setAberto(false); tirarDaUrl(); }

  return (
    <>
      {painelAberto && (
        <section role="dialog" aria-label="Suporte Sellergy"
          className="fixed z-40 inset-0 sm:inset-auto sm:right-4 sm:bottom-[68px] sm:w-[340px] sm:h-[min(520px,calc(100vh-96px))] flex flex-col overflow-hidden bg-[var(--bg-card)] sm:rounded-2xl shadow-[0_18px_44px_rgba(10,20,15,0.28),0_2px_6px_rgba(10,20,15,0.12)] border border-[var(--border-main)] text-[13px]">
          <header className="flex items-center gap-2.5 px-3 py-2.5 text-white bg-[linear-gradient(135deg,#0F1A15,#15322A)]">
            {telaAtual.tipo !== 'inicio' && (
              <button type="button" onClick={irInicio} aria-label="Voltar" className="-ml-1 w-7 h-7 rounded-full grid place-items-center hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <ArrowLeft size={16} />
              </button>
            )}
            <img src="/logo-sellergy.png" alt="" className="w-8 h-8 rounded-full border-[1.5px] border-white/90 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-['Space_Grotesk',Inter,sans-serif] font-bold text-[14px] leading-tight">Suporte Sellergy</p>
              <p className="text-[11px] text-[#B7C4BD] font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1FA672]" aria-hidden="true" />
                {somenteLeitura ? 'Sessão de suporte: só leitura' : 'Online · responde em até 1 hora'}
              </p>
            </div>
            <button type="button" onClick={fechar} aria-label="Fechar" className="w-7 h-7 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <X size={15} />
            </button>
          </header>

          {telaAtual.tipo === 'novo' ? (
            <Novo onCriado={(id) => setTela({ tipo: 'conversa', id })} />
          ) : telaAtual.tipo === 'conversa' ? (
            <Conversa key={telaAtual.id} chamadoId={telaAtual.id} somenteLeitura={somenteLeitura} />
          ) : (
            <Inicio
              nome={nome}
              chamados={chamados}
              erro={erro}
              carregando={carregando}
              somenteLeitura={somenteLeitura}
              linkTela={linkAjuda(location.pathname)}
              onAbrir={(id) => setTela({ tipo: 'conversa', id })}
              onNovo={() => setTela({ tipo: 'novo' })}
              onTentar={() => { setCarregando(true); carregar(); }}
            />
          )}
        </section>
      )}

      <button
        type="button"
        onClick={alternar}
        aria-expanded={painelAberto}
        aria-label={painelAberto ? 'Fechar o suporte' : 'Ajuda: falar com o suporte'}
        className={clsx('fixed bottom-4 right-4 z-40 w-11 h-11 grid place-items-center rounded-full bg-[var(--primary)] text-[var(--text-on-primary)] shadow-[0_6px_18px_rgba(19,111,77,0.4)] hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--primary)]',
          (painelAberto || naTelaDoWhatsapp) && 'max-sm:hidden')}
      >
        {painelAberto ? <ChevronDown size={18} /> : <MessageCircle size={18} aria-hidden="true" />}
      </button>
    </>
  );
}

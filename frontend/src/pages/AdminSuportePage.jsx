// /admin/suporte — caixa de entrada do suporte: fila a esquerda, conversa a
// direita. Responder, nota interna (so a equipe ve), responsavel, prioridade,
// categoria, respostas prontas, resolver e "ver como o cliente".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, LifeBuoy, MessageSquare, Pencil, Plus, RotateCcw, Search, Send, Star, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { Button, EmptyState, Input, Textarea, useToast } from '../components/ui';
import Modal from '../components/Modal';
import ConfirmarAcao from '../components/conta/ConfirmarAcao';
import { STATUS_ASSINATURA } from '../components/conta/rotulosAssinatura';
import { Carregando, ErroCarregar, SemPermissao } from '../components/suporte/EstadosAdmin';
import { dataHora, erroDaApi, usePapelAdmin, entrarComoSuporte } from '../components/suporte/papelAdmin';

const STATUS = {
  ABERTO: { rotulo: 'Esperando você', classe: 'bg-[var(--warning-soft)] text-[var(--warning-text)]' },
  RESPONDIDO: { rotulo: 'Esperando cliente', classe: 'bg-[var(--info-soft)] text-[var(--info-text)]' },
  RESOLVIDO: { rotulo: 'Resolvido', classe: 'bg-[var(--success-soft)] text-[var(--success-text)]' },
};

const ABAS = [
  { valor: 'ABERTO', rotulo: 'Esperando você' },
  { valor: 'MEUS', rotulo: 'Meus' },
  { valor: 'CLIENTE', rotulo: 'Esperando cliente' },
  { valor: 'RESOLVIDO', rotulo: 'Resolvidos' },
];

const CATEGORIAS = { DUVIDA: 'Dúvida', ERRO: 'Erro', COBRANCA: 'Cobrança', FISCAL: 'Nota fiscal', WHATSAPP: 'WhatsApp', OUTRO: 'Outro' };
const PRIORIDADES = { ALTA: 'Alta', NORMAL: 'Normal', BAIXA: 'Baixa' };
const COR_PRIORIDADE = { ALTA: 'text-[var(--danger-text)]', NORMAL: 'text-[var(--text-main)]', BAIXA: 'text-[var(--text-muted)]' };

function iniciais(nome) {
  return String(nome || '?').split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || String(nome || '?')[0].toUpperCase();
}

// "há 40 min", "há 2 h", "ontem"...
function haQuanto(v, agora) {
  if (!v) return '';
  const min = Math.max(0, Math.round((agora - new Date(v).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

function Avatar({ nome, tom = 'cliente', tamanho = 'w-9 h-9' }) {
  const cores = {
    cliente: 'bg-[var(--primary-soft)] text-[var(--primary)]',
    suporte: 'bg-[var(--primary)] text-[var(--text-on-primary)]',
    interno: 'bg-[var(--warning-soft)] text-[var(--warning-text)]',
  };
  return (
    <span aria-hidden="true" className={clsx('shrink-0 rounded-full flex items-center justify-center text-xs font-bold', tamanho, cores[tom])}>
      {iniciais(nome)}
    </span>
  );
}

function EditorRespostas({ isOpen, onClose, respostas, onSalvo }) {
  const toast = useToast();
  const [lista, setLista] = useState(respostas);
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState([]);

  const mudar = (i, campo, valor) => setLista((l) => l.map((r, j) => (j === i ? { ...r, [campo]: valor } : r)));

  const salvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const r = await api.put('/admin/suporte/respostas-prontas', { respostas: lista });
      toast.success('Respostas prontas salvas.');
      onSalvo(r.data.respostas);
      onClose();
    } catch (err) {
      setErros(err.response?.data?.campos || []);
      toast.error(erroDaApi(err, 'Não foi possível salvar.'));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Respostas prontas" description="Textos que você usa sempre. Um clique coloca na resposta." size="lg">
      <form onSubmit={salvar} className="space-y-4">
        {lista.length === 0 && <p className="text-sm text-[var(--text-muted)]">Nenhuma resposta pronta. Adicione a primeira.</p>}
        {lista.map((r, i) => (
          <fieldset key={i} className="rounded-xl border border-[var(--border-main)] p-3 space-y-2">
            <legend className="sr-only">Resposta {i + 1}</legend>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input label="Nome curto" value={r.titulo || ''} maxLength={40} onChange={(e) => mudar(i, 'titulo', e.target.value)}
                  error={erros.includes(`respostas.${i}.titulo`) ? 'De 2 a 40 letras' : undefined} />
              </div>
              <Button variant="ghost" className="min-h-11" icon={Trash2} aria-label={`Remover resposta ${r.titulo || i + 1}`}
                onClick={() => setLista((l) => l.filter((_, j) => j !== i))} />
            </div>
            <Textarea label="Texto" rows={3} value={r.texto || ''} maxLength={1000} onChange={(e) => mudar(i, 'texto', e.target.value)}
              error={erros.includes(`respostas.${i}.texto`) ? 'Escreva o texto' : undefined} />
          </fieldset>
        ))}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" className="min-h-11" icon={Plus} disabled={lista.length >= 30}
            onClick={() => setLista((l) => [...l, { titulo: '', texto: '' }])}>
            Adicionar resposta
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" className="min-h-11" onClick={onClose}>Cancelar</Button>
            <Button type="submit" className="min-h-11" loading={salvando}>Salvar</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// Seletor "sem borda" da faixa de detalhes do chamado.
function CampoFaixa({ rotulo, valor, opcoes, onChange, disabled, classeValor }) {
  return (
    <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
      {rotulo}
      <select value={valor} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className={clsx('min-h-9 bg-transparent font-semibold rounded-md px-1 cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]', classeValor || 'text-[var(--text-main)]')}>
        {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
    </label>
  );
}

function Conversa({ chamadoId, respostas, equipe, podeResponder, podeEntrar, onMudou, onVoltar }) {
  const toast = useToast();
  const [chamado, setChamado] = useState(null);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [modo, setModo] = useState('resposta'); // resposta | nota
  const [enviando, setEnviando] = useState(false);
  const [confirmarEntrar, setConfirmarEntrar] = useState(false);
  const [mostrarProntas, setMostrarProntas] = useState(false);
  const fimRef = useRef(null);

  const carregar = useCallback(() => api.get(`/admin/suporte/chamados/${chamadoId}`)
    .then((r) => { setChamado(r.data); setErro(''); onMudou({ silencioso: true }); })
    .catch((e) => setErro(erroDaApi(e, 'Não foi possível abrir o chamado.'))), [chamadoId, onMudou]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { fimRef.current?.scrollIntoView({ block: 'end' }); }, [chamado?.mensagens?.length]);

  const enviar = async (resolver = false) => {
    if (!texto.trim()) { toast.error(modo === 'nota' ? 'Escreva a nota.' : 'Escreva a resposta.'); return; }
    setEnviando(true);
    try {
      if (modo === 'nota') {
        const r = await api.post(`/admin/suporte/chamados/${chamadoId}/nota`, { texto });
        setChamado(r.data);
        toast.success('Nota salva. Só a equipe vê.');
      } else {
        const r = await api.post(`/admin/suporte/chamados/${chamadoId}/responder`, { texto, resolver });
        setChamado(r.data.chamado);
        toast.success(r.data.whatsapp === 'enviado'
          ? 'Resposta enviada. O cliente foi avisado no sistema e no WhatsApp.'
          : 'Resposta enviada. O cliente foi avisado no sistema.');
      }
      setTexto('');
      onMudou();
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível enviar.'));
    } finally {
      setEnviando(false);
    }
  };

  const mudarStatus = async (acao) => {
    try {
      const r = await api.post(`/admin/suporte/chamados/${chamadoId}/${acao}`);
      setChamado(r.data);
      toast.success(acao === 'resolver' ? 'Chamado resolvido.' : 'Chamado reaberto.');
      onMudou();
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível atualizar o chamado.'));
    }
  };

  const editar = async (campo, valor) => {
    try {
      const r = await api.patch(`/admin/suporte/chamados/${chamadoId}`, { [campo]: valor === '' ? null : valor });
      setChamado(r.data);
      onMudou();
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível salvar.'));
    }
  };

  if (erro) return <div className="p-6"><ErroCarregar texto={erro} onTentar={carregar} /></div>;
  if (!chamado) return <div className="p-6"><Carregando linhas={5} /></div>;

  const st = STATUS[chamado.status] || { rotulo: chamado.status, classe: '' };
  const sa = STATUS_ASSINATURA[chamado.cliente?.statusAssinatura];
  const nota = modo === 'nota';
  const opcoesEquipe = [['', 'Ninguém'], ...equipe.map((u) => [u.id, u.nome])];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* cabecalho */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-[var(--border-main)] flex flex-wrap items-center gap-3">
        <button type="button" onClick={onVoltar} aria-label="Voltar para a fila"
          className="lg:hidden w-10 h-10 rounded-lg flex items-center justify-center hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-[220px]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--text-main)] break-words">{chamado.assunto}</h2>
            <span className={clsx('px-2 py-0.5 rounded-full text-[11px] font-bold', st.classe)}>{st.rotulo}</span>
          </div>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
            {chamado.cliente?.nome || 'Negócio removido'}
            {chamado.abertoPor ? ` · ${chamado.abertoPor}` : ''}
            {chamado.cliente ? ` · plano ${chamado.cliente.planoNome}` : ''}
            {sa ? ` · ${sa.rotulo.toLowerCase()}` : ''}
            {chamado.cliente?.telefone ? ` · ${chamado.cliente.telefone}` : ''}
          </p>
        </div>
        {podeEntrar && chamado.cliente && (
          <Button variant="secondary" className="min-h-10" icon={Eye} onClick={() => setConfirmarEntrar(true)}>Ver como o cliente</Button>
        )}
        {podeResponder && (chamado.status === 'RESOLVIDO'
          ? <Button variant="secondary" className="min-h-10" icon={RotateCcw} onClick={() => mudarStatus('reabrir')}>Reabrir</Button>
          : <Button className="min-h-10" icon={CheckCircle2} onClick={() => mudarStatus('resolver')}>Resolver</Button>)}
      </div>

      {/* faixa de detalhes */}
      <div className="px-4 sm:px-6 py-1 border-b border-[var(--border-main)] bg-[var(--bg-subtle)] flex flex-wrap items-center gap-x-5 gap-y-1">
        <CampoFaixa rotulo="Responsável" valor={chamado.responsavel?.id || ''} opcoes={opcoesEquipe} disabled={!podeResponder}
          onChange={(v) => editar('responsavelId', v)} />
        <CampoFaixa rotulo="Prioridade" valor={chamado.prioridade} opcoes={Object.entries(PRIORIDADES)} disabled={!podeResponder}
          onChange={(v) => editar('prioridade', v)} classeValor={COR_PRIORIDADE[chamado.prioridade]} />
        <CampoFaixa rotulo="Categoria" valor={chamado.categoria} opcoes={Object.entries(CATEGORIAS)} disabled={!podeResponder}
          onChange={(v) => editar('categoria', v)} />
        <span className="text-[13px] text-[var(--text-muted)]">
          aberto {dataHora(chamado.criadoEm)} pelo {chamado.canal === 'WHATSAPP' ? 'WhatsApp' : 'sistema'}
          {chamado.avaliacao ? <> · avaliação <b className="text-[var(--text-main)]">{chamado.avaliacao}/5</b></> : null}
        </span>
      </div>

      {/* mensagens */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-6">
        <ol className="max-w-[720px] mx-auto space-y-5" aria-label="Mensagens do chamado">
          {chamado.mensagens.map((m) => {
            const interno = m.autor === 'INTERNO';
            const suporte = m.autor === 'SUPORTE';
            return (
              <li key={m.id} className={clsx('flex gap-3', interno && 'rounded-xl border border-[var(--warning-soft)] bg-[var(--warning-soft)]/50 px-3.5 py-3')}>
                <Avatar nome={m.autorNome} tom={interno ? 'interno' : suporte ? 'suporte' : 'cliente'} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px]">
                    <b className="text-[var(--text-main)]">{m.autorNome}</b>{' '}
                    <span className="text-[var(--text-muted)]">{interno ? 'nota interna, só a equipe vê' : suporte ? 'Sellergy' : 'cliente'} · {dataHora(m.criadoEm)}</span>
                  </p>
                  <p className="text-[15px] leading-relaxed text-[var(--text-main)] whitespace-pre-wrap break-words mt-0.5">{m.texto}</p>
                </div>
              </li>
            );
          })}
          {chamado.avaliacaoComentario && (
            <li className="flex gap-3 text-[13px] text-[var(--text-muted)]">
              <Star size={16} className="mt-0.5 text-[var(--accent)]" aria-hidden="true" />
              <span>O cliente avaliou com {chamado.avaliacao}/5: “{chamado.avaliacaoComentario}”</span>
            </li>
          )}
        </ol>
        <div ref={fimRef} />
        {chamado.anteriores?.length > 0 && (
          <div className="max-w-[720px] mx-auto mt-8 pt-4 border-t border-[var(--border-main)]">
            <p className="text-xs font-bold tracking-wide text-[var(--text-muted)] mb-2">CHAMADOS ANTERIORES DESTE NEGÓCIO</p>
            <ul className="space-y-1 text-[13px]">
              {chamado.anteriores.map((a) => (
                <li key={a.id} className="text-[var(--text-secondary)]">
                  {a.assunto} · <span className="text-[var(--text-muted)]">{(STATUS[a.status]?.rotulo || a.status).toLowerCase()} · {dataHora(a.criadoEm)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* resposta */}
      {podeResponder ? (
        <div className="px-4 sm:px-6 pb-4">
          <div className={clsx('max-w-[720px] mx-auto rounded-2xl border overflow-hidden',
            nota ? 'border-[var(--warning)] bg-[var(--warning-soft)]/40' : 'border-[var(--border-strong)] bg-[var(--bg-card)]')}>
            <div className="flex gap-1 px-2 pt-2" role="tablist" aria-label="Tipo de mensagem">
              {[['resposta', 'Responder'], ['nota', 'Nota interna']].map(([v, r]) => (
                <button key={v} type="button" role="tab" aria-selected={modo === v} onClick={() => setModo(v)}
                  className={clsx('min-h-9 px-3 rounded-lg text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
                    modo === v ? (v === 'nota' ? 'bg-[var(--warning-soft)] text-[var(--warning-text)]' : 'bg-[var(--bg-subtle)] text-[var(--text-main)]') : 'text-[var(--text-muted)] hover:text-[var(--text-main)]')}>
                  {r}
                </button>
              ))}
            </div>
            <label className="sr-only" htmlFor="resposta-suporte">{nota ? 'Nota interna' : 'Resposta para o cliente'}</label>
            <textarea id="resposta-suporte" rows={3} value={texto} maxLength={4000}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar(false); }}
              placeholder={nota ? 'Só a equipe vê esta nota' : 'Escreva a resposta pro cliente'}
              className="block w-full bg-transparent px-3.5 py-2.5 text-[15px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none" />
            {mostrarProntas && respostas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2" role="group" aria-label="Respostas prontas">
                {respostas.map((r, i) => (
                  <button key={i} type="button" onClick={() => { setTexto((t) => (t ? `${t}\n\n${r.texto}` : r.texto)); setMostrarProntas(false); }}
                    className="min-h-9 px-3 rounded-full border border-dashed border-[var(--border-strong)] text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                    {r.titulo}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 px-2 py-2 border-t border-[var(--border-subtle)]">
              <button type="button" onClick={() => setMostrarProntas((v) => !v)} aria-expanded={mostrarProntas}
                className="min-h-9 px-2.5 rounded-lg text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                Respostas prontas
              </button>
              <span className="flex-1" />
              <span className="hidden sm:inline text-xs text-[var(--text-muted)]">{nota ? 'O cliente não vê' : 'Vai pro sistema e pro WhatsApp do cliente'} · Ctrl+Enter envia</span>
              {!nota && chamado.status !== 'RESOLVIDO' && (
                <Button variant="secondary" className="min-h-9" loading={enviando} onClick={() => enviar(true)}>Enviar e resolver</Button>
              )}
              <Button className="min-h-9" icon={Send} loading={enviando} onClick={() => enviar(false)}>{nota ? 'Salvar nota' : 'Enviar'}</Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="px-6 py-4 border-t border-[var(--border-main)] text-sm text-[var(--text-muted)]">Seu papel na equipe só permite ver os chamados.</p>
      )}

      <ConfirmarAcao
        isOpen={confirmarEntrar}
        onClose={() => setConfirmarEntrar(false)}
        titulo={`Ver o sistema de ${chamado.cliente?.nome || ''}?`}
        rotuloConfirmar="Entrar (só leitura)"
        variante="primary"
        pedirMotivo
        rotuloMotivo="Motivo (vai para a auditoria)"
        onConfirmar={(motivo) => entrarComoSuporte({ clienteId: chamado.cliente.id, chamadoId: chamado.id, motivo }).then((ok) => {
          if (!ok.ok) toast.error(ok.erro);
          return ok.ok;
        })}
      >
        <p>Você vê o sistema como o dono do negócio, por 30 minutos, sem poder criar ou alterar nada. A entrada e a saída ficam na auditoria.</p>
        <p className="mt-2">Para sua segurança, você sai do painel admin: ao encerrar, entre de novo com sua senha e o código.</p>
      </ConfirmarAcao>
    </div>
  );
}

export default function AdminSuportePage() {
  const { pode } = usePapelAdmin();
  const [aba, setAba] = useState('ABERTO');
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState(null);
  // Hora da ultima carga: base do "ha quanto tempo" da fila (sem Date.now no render).
  const [agora, setAgora] = useState(0);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [selecionado, setSelecionado] = useState(null);
  const [respostas, setRespostas] = useState([]);
  const [equipe, setEquipe] = useState([]);
  const [editando, setEditando] = useState(false);

  const carregar = useCallback(() => {
    const params = new URLSearchParams({ aba });
    if (busca.trim()) params.set('busca', busca.trim());
    api.get('/admin/suporte/resumo').then((r) => setResumo(r.data)).catch(() => {});
    return api.get(`/admin/suporte/chamados?${params}`)
      .then((r) => { setDados(r.data); setAgora(Date.now()); setErro(''); })
      .catch((e) => setErro(erroDaApi(e, 'Não foi possível carregar os chamados.')))
      .finally(() => setCarregando(false));
  }, [aba, busca]);

  useEffect(() => {
    const t = setTimeout(carregar, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);
  // A fila se atualiza sozinha enquanto a tela esta aberta.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 30_000);
    return () => clearInterval(t);
  }, [carregar]);
  useEffect(() => {
    api.get('/admin/suporte/respostas-prontas').then((r) => setRespostas(r.data.respostas || [])).catch(() => {});
    api.get('/admin/suporte/equipe').then((r) => setEquipe(r.data.equipe || [])).catch(() => {});
  }, []);

  const aoMudar = useCallback(() => { carregar(); }, [carregar]);
  const chamados = useMemo(() => dados?.chamados || [], [dados]);
  const contagem = dados?.contagem || {};

  if (!pode('suporte.ver')) return <SemPermissao />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-[var(--text-muted)]">
        <span><b className="text-[var(--text-main)] text-base">{resumo?.esperando ?? '–'}</b> esperando você</span>
        <span>1ª resposta média <b className="text-[var(--text-main)]">{resumo?.primeiraRespostaMin != null ? `${resumo.primeiraRespostaMin} min` : '–'}</b></span>
        <span>satisfação <b className="text-[var(--text-main)]">{resumo?.satisfacao != null ? `${String(resumo.satisfacao).replace('.', ',')}/5` : '–'}</b>{resumo?.avaliacoes ? ` (${resumo.avaliacoes})` : ''}</span>
        <span className="flex-1" />
        {pode('suporte.responder') && (
          <Button variant="ghost" className="min-h-10" icon={Pencil} onClick={() => setEditando(true)}>Respostas prontas</Button>
        )}
      </div>

      <section className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] overflow-hidden flex h-[calc(100vh-190px)] min-h-[560px]">
        {/* caixa de entrada */}
        <div className={clsx('w-full lg:w-[340px] lg:shrink-0 lg:border-r border-[var(--border-main)] flex-col min-h-0', selecionado ? 'hidden lg:flex' : 'flex')}>
          <div className="px-4 pt-4 space-y-3">
            <label className="flex items-center gap-2 min-h-10 px-3 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-muted)]">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Buscar chamado</span>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por assunto ou negócio"
                className="flex-1 min-w-0 bg-transparent text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none" />
            </label>
            <div role="tablist" aria-label="Filas" className="flex gap-4 border-b border-[var(--border-main)] overflow-x-auto">
              {ABAS.map((a) => (
                <button key={a.valor} type="button" role="tab" aria-selected={aba === a.valor}
                  onClick={() => { setCarregando(true); setAba(a.valor); }}
                  className={clsx('min-h-10 whitespace-nowrap text-[13px] font-semibold border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
                    aba === a.valor ? 'border-[var(--primary)] text-[var(--text-main)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]')}>
                  {a.rotulo} <span className="font-medium text-[var(--text-muted)]">{contagem[a.valor] ?? ''}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {erro ? (
              <div className="p-4"><ErroCarregar texto={erro} onTentar={() => { setCarregando(true); carregar(); }} /></div>
            ) : carregando && !dados ? (
              <div className="p-4"><Carregando linhas={5} /></div>
            ) : chamados.length === 0 ? (
              <EmptyState icon={LifeBuoy} title="Nada por aqui" description={aba === 'ABERTO' ? 'Nenhum cliente esperando. Quando alguém pedir ajuda, aparece aqui.' : 'Nenhum chamado nesta fila.'} />
            ) : (
              <ul>
                {chamados.map((c) => {
                  const parado = c.status === 'ABERTO' && c.ultimaDoClienteEm;
                  const atrasado = parado && agora - new Date(c.ultimaDoClienteEm).getTime() > 60 * 60 * 1000;
                  return (
                    <li key={c.id}>
                      <button type="button" onClick={() => setSelecionado(c.id)} aria-current={selecionado === c.id ? 'true' : undefined}
                        className={clsx('w-full text-left flex gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]',
                          selecionado === c.id && 'bg-[var(--primary-soft)]/60')}>
                        <Avatar nome={c.cliente?.nome} />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={clsx('text-[13px] truncate text-[var(--text-main)]', c.naoLido ? 'font-bold' : 'font-medium')}>{c.cliente?.nome || 'Negócio removido'}</span>
                            <span className={clsx('text-xs whitespace-nowrap', atrasado ? 'text-[var(--danger-text)] font-semibold' : 'text-[var(--text-muted)]')}>
                              {haQuanto(parado ? c.ultimaDoClienteEm : c.atualizadoEm, agora)}
                            </span>
                          </span>
                          <span className={clsx('block text-sm truncate text-[var(--text-main)]', c.naoLido ? 'font-semibold' : '')}>
                            {c.prioridade === 'ALTA' && <span className="text-[var(--danger-text)]" title="Prioridade alta">● </span>}
                            {c.assunto}
                          </span>
                          <span className="block text-[13px] truncate text-[var(--text-muted)]">
                            {c.ultimaMensagem ? `${c.ultimaMensagem.autor === 'SUPORTE' ? 'Você: ' : c.ultimaMensagem.autor === 'INTERNO' ? 'Nota: ' : ''}${c.ultimaMensagem.texto}` : ''}
                          </span>
                          <span className="flex items-center gap-1.5 mt-1 text-[11px] text-[var(--text-muted)]">
                            <span className="px-1.5 py-px rounded bg-[var(--bg-subtle)]">{CATEGORIAS[c.categoria] || c.categoria}</span>
                            {c.responsavel && <span>· {c.responsavel.nome}</span>}
                          </span>
                        </span>
                        {c.naoLido && <span className="sr-only">não lido</span>}
                        {c.naoLido && <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* conversa */}
        <div className={clsx('flex-1 min-w-0 flex-col min-h-0', selecionado ? 'flex' : 'hidden lg:flex')}>
          {selecionado ? (
            <Conversa
              key={selecionado}
              chamadoId={selecionado}
              respostas={respostas}
              equipe={equipe}
              podeResponder={pode('suporte.responder')}
              podeEntrar={pode('suporte.entrar')}
              onMudou={aoMudar}
              onVoltar={() => setSelecionado(null)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState icon={MessageSquare} title="Escolha um chamado" description="A conversa abre aqui, com nota interna e respostas prontas." />
            </div>
          )}
        </div>
      </section>

      {editando && (
        <EditorRespostas isOpen onClose={() => setEditando(false)} respostas={respostas} onSalvo={setRespostas} />
      )}
    </div>
  );
}

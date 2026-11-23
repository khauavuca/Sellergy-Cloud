// /admin/suporte — fila de chamados, conversa, respostas prontas, resolver e
// "entrar como suporte" (frente D da fase 2).
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Eye, LifeBuoy, MessageSquare, Pencil, Plus, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { Badge, Button, EmptyState, Input, SearchBar, Textarea, useToast } from '../components/ui';
import Modal from '../components/Modal';
import ConfirmarAcao from '../components/conta/ConfirmarAcao';
import { STATUS_ASSINATURA } from '../components/conta/rotulosAssinatura';
import { Carregando, ErroCarregar, SemPermissao } from '../components/suporte/EstadosAdmin';
import { dataHora, erroDaApi, usePapelAdmin, entrarComoSuporte } from '../components/suporte/papelAdmin';

const STATUS = {
  ABERTO: { rotulo: 'Esperando resposta', variante: 'warning' },
  RESPONDIDO: { rotulo: 'Respondido', variante: 'info' },
  RESOLVIDO: { rotulo: 'Resolvido', variante: 'success' },
};

const FILTROS = [
  { valor: 'PENDENTES', rotulo: 'Em andamento' },
  { valor: 'ABERTO', rotulo: 'Esperando' },
  { valor: 'RESPONDIDO', rotulo: 'Respondidos' },
  { valor: 'RESOLVIDO', rotulo: 'Resolvidos' },
  { valor: 'TODOS', rotulo: 'Todos' },
];

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

function Conversa({ chamadoId, respostas, podeResponder, podeEntrar, onMudou }) {
  const toast = useToast();
  const [chamado, setChamado] = useState(null);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [confirmarEntrar, setConfirmarEntrar] = useState(false);

  const carregar = useCallback(() => api.get(`/admin/suporte/chamados/${chamadoId}`)
    .then((r) => { setChamado(r.data); setErro(''); })
    .catch((e) => setErro(erroDaApi(e, 'Não foi possível abrir o chamado.'))), [chamadoId]);

  useEffect(() => { carregar(); }, [carregar]);

  const responder = async (resolver) => {
    if (!texto.trim()) { toast.error('Escreva a resposta.'); return; }
    setEnviando(true);
    try {
      const r = await api.post(`/admin/suporte/chamados/${chamadoId}/responder`, { texto, resolver });
      setChamado(r.data.chamado);
      setTexto('');
      toast.success(r.data.whatsapp === 'enviado'
        ? 'Resposta enviada. O cliente foi avisado no sistema e no WhatsApp.'
        : 'Resposta enviada. O cliente foi avisado no sistema (WhatsApp do Sellergy indisponível).');
      onMudou();
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível responder.'));
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

  if (erro) return <ErroCarregar texto={erro} onTentar={carregar} />;
  if (!chamado) return <Carregando linhas={4} />;

  const st = STATUS[chamado.status] || { rotulo: chamado.status, variante: 'neutral' };
  const sa = STATUS_ASSINATURA[chamado.cliente?.statusAssinatura];

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[var(--border-main)]">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--text-main)] break-words">{chamado.assunto}</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            {chamado.cliente?.nome || 'Negócio removido'}
            {chamado.abertoPor ? ` · ${chamado.abertoPor}` : ''}
            {chamado.cliente ? ` · plano ${chamado.cliente.planoNome}` : ''}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Badge variant={st.variante} size="sm">{st.rotulo}</Badge>
            {sa && <Badge variant={sa.variante} size="sm">{sa.rotulo}</Badge>}
            {chamado.cliente?.telefone && <Badge variant="neutral" size="sm">{chamado.cliente.telefone}</Badge>}
          </div>
        </div>
        {podeEntrar && chamado.cliente && (
          <Button variant="secondary" className="min-h-11" icon={Eye} onClick={() => setConfirmarEntrar(true)}>
            Entrar como suporte
          </Button>
        )}
      </div>

      <ol className="flex-1 space-y-3 py-4 overflow-y-auto max-h-[50vh]" aria-label="Mensagens do chamado">
        {chamado.mensagens.map((m) => (
          <li key={m.id} className={clsx('max-w-[85%] rounded-2xl px-4 py-2.5', m.autor === 'SUPORTE'
            ? 'ml-auto bg-[var(--primary)] text-[var(--text-on-primary)]'
            : 'bg-[var(--bg-subtle)] text-[var(--text-main)]')}>
            <p className="text-xs font-semibold opacity-80">{m.autor === 'SUPORTE' ? `${m.autorNome} (Sellergy)` : m.autorNome} · {dataHora(m.criadoEm)}</p>
            <p className="text-sm whitespace-pre-wrap break-words mt-0.5">{m.texto}</p>
          </li>
        ))}
      </ol>

      {podeResponder ? (
        <div className="pt-4 border-t border-[var(--border-main)] space-y-3">
          {respostas.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Respostas prontas">
              {respostas.map((r, i) => (
                <button key={i} type="button" onClick={() => setTexto(r.texto)}
                  className="min-h-11 px-3 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                  {r.titulo}
                </button>
              ))}
            </div>
          )}
          <Textarea label="Sua resposta" rows={3} value={texto} maxLength={4000} onChange={(e) => setTexto(e.target.value)}
            hint="O cliente recebe um aviso no sistema e no WhatsApp do Sellergy." />
          <div className="flex flex-wrap gap-2 justify-end">
            {chamado.status === 'RESOLVIDO' ? (
              <Button variant="ghost" className="min-h-11" icon={RotateCcw} onClick={() => mudarStatus('reabrir')}>Reabrir</Button>
            ) : (
              <Button variant="ghost" className="min-h-11" icon={CheckCircle2} onClick={() => mudarStatus('resolver')}>Marcar como resolvido</Button>
            )}
            <Button variant="secondary" className="min-h-11" loading={enviando} onClick={() => responder(true)}>Responder e resolver</Button>
            <Button className="min-h-11" icon={Send} loading={enviando} onClick={() => responder(false)}>Responder</Button>
          </div>
        </div>
      ) : (
        <p className="pt-4 border-t border-[var(--border-main)] text-sm text-[var(--text-muted)]">Seu papel na equipe só permite ver os chamados.</p>
      )}

      <ConfirmarAcao
        isOpen={confirmarEntrar}
        onClose={() => setConfirmarEntrar(false)}
        titulo={`Entrar como suporte em ${chamado.cliente?.nome || ''}?`}
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
  const [filtro, setFiltro] = useState('PENDENTES');
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [selecionado, setSelecionado] = useState(null);
  const [respostas, setRespostas] = useState([]);
  const [editando, setEditando] = useState(false);

  const carregar = useCallback(() => {
    const params = new URLSearchParams();
    if (filtro !== 'PENDENTES') params.set('status', filtro);
    if (busca.trim()) params.set('busca', busca.trim());
    return api.get(`/admin/suporte/chamados?${params}`)
      .then((r) => { setDados(r.data); setErro(''); })
      .catch((e) => setErro(erroDaApi(e, 'Não foi possível carregar os chamados.')))
      .finally(() => setCarregando(false));
  }, [filtro, busca]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    api.get('/admin/suporte/respostas-prontas').then((r) => setRespostas(r.data.respostas || [])).catch(() => {});
  }, []);

  if (!pode('suporte.ver')) return <SemPermissao />;

  const chamados = dados?.chamados || [];
  const contagem = dados?.contagem || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-main)]">Suporte</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Chamados abertos pelo botão Ajuda do sistema. {contagem.ABERTO ? `${contagem.ABERTO} esperando resposta.` : 'Nenhum esperando resposta.'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {pode('suporte.responder') && (
            <Button variant="secondary" className="min-h-11" icon={Pencil} onClick={() => setEditando(true)}>Respostas prontas</Button>
          )}
          <Button variant="secondary" className="min-h-11" icon={RefreshCw} loading={carregando} onClick={() => { setCarregando(true); carregar(); }}>
            Atualizar
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
        <div role="group" aria-label="Filtrar chamados" className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button key={f.valor} type="button" aria-pressed={filtro === f.valor}
              onClick={() => { setCarregando(true); setFiltro(f.valor); }}
              className={clsx('min-h-11 px-3.5 rounded-lg text-sm font-semibold border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
                filtro === f.valor
                  ? 'bg-[var(--primary)] text-[var(--text-on-primary)] border-[var(--primary)]'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-main)] hover:text-[var(--text-main)]')}>
              {f.rotulo}
            </button>
          ))}
        </div>
        <div className="w-full lg:w-72">
          <SearchBar value={busca} onChange={(e) => { setCarregando(true); setBusca(e.target.value); }} onClear={() => setBusca('')} placeholder="Buscar pelo assunto" />
        </div>
      </div>

      {erro && <ErroCarregar texto={erro} onTentar={() => { setCarregando(true); carregar(); }} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <section aria-label="Lista de chamados" className="lg:col-span-2 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] overflow-hidden">
          {carregando && !dados ? (
            <div className="p-4"><Carregando linhas={4} /></div>
          ) : chamados.length === 0 ? (
            <EmptyState icon={LifeBuoy} title="Nenhum chamado aqui" description={filtro === 'PENDENTES' ? 'Quando um cliente pedir ajuda, aparece nesta fila.' : 'Mude o filtro.'} />
          ) : (
            <ul className="divide-y divide-[var(--border-main)]">
              {chamados.map((c) => {
                const st = STATUS[c.status] || { rotulo: c.status, variante: 'neutral' };
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setSelecionado(c.id)} aria-current={selecionado === c.id ? 'true' : undefined}
                      className={clsx('w-full text-left px-4 py-3 min-h-11 hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]',
                        selecionado === c.id && 'bg-[var(--bg-subtle)]')}>
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-[var(--text-main)] truncate">{c.cliente?.nome || 'Negócio removido'}</span>
                          <span className="block text-sm text-[var(--text-secondary)] truncate">{c.assunto}</span>
                        </span>
                        <Badge variant={st.variante} size="sm">{st.rotulo}</Badge>
                      </span>
                      <span className="block text-xs text-[var(--text-muted)] mt-1 truncate">
                        {dataHora(c.atualizadoEm)}{c.ultimaMensagem ? ` · ${c.ultimaMensagem.autor === 'SUPORTE' ? 'Você: ' : ''}${c.ultimaMensagem.texto}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Conversa" className="lg:col-span-3 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 min-h-[320px]">
          {selecionado ? (
            <Conversa
              key={selecionado}
              chamadoId={selecionado}
              respostas={respostas}
              podeResponder={pode('suporte.responder')}
              podeEntrar={pode('suporte.entrar')}
              onMudou={carregar}
            />
          ) : (
            <EmptyState icon={MessageSquare} title="Escolha um chamado" description="A conversa aparece aqui, com as respostas prontas." />
          )}
        </section>
      </div>

      {editando && (
        <EditorRespostas isOpen onClose={() => setEditando(false)} respostas={respostas} onSalvo={setRespostas} />
      )}
    </div>
  );
}

// Botao flutuante "Ajuda": abre chamado com o suporte e mostra as respostas. Frente D da fase 2.
// Rotas: /suporte/chamados (lista, abrir, responder). Quando o suporte
// responde, a notificacao leva pra ?ajuda=<chamadoId> e este painel abre na
// conversa. Na sessao de suporte (so leitura) da pra ver, nao escrever.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, HelpCircle, LifeBuoy, Plus, Send } from 'lucide-react';
import clsx from 'clsx';
import api from '../../services/api';
import { useAuthStore } from '../../store/auth.store';
import { Badge, Button, Drawer, EmptyState, Input, Textarea, useToast } from '../ui';

const STATUS = {
  ABERTO: { rotulo: 'Aguardando o suporte', variante: 'warning' },
  RESPONDIDO: { rotulo: 'Respondido', variante: 'info' },
  RESOLVIDO: { rotulo: 'Resolvido', variante: 'success' },
};

function quando(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Lista({ chamados, erro, carregando, onAbrir, onNovo, onTentar, somenteLeitura }) {
  if (carregando && !chamados) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-[var(--bg-subtle)] animate-pulse" />)}
      </div>
    );
  }
  if (erro) {
    return (
      <div role="alert" className="space-y-3 text-sm text-[var(--danger-text)]">
        <p>{erro}</p>
        <Button variant="secondary" className="min-h-11" onClick={onTentar}>Tentar de novo</Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {!somenteLeitura && (
        <Button className="min-h-11 w-full" icon={Plus} onClick={onNovo}>Falar com o suporte</Button>
      )}
      {(chamados || []).length === 0 ? (
        <EmptyState icon={LifeBuoy} title="Nenhum chamado ainda" description="Tem dúvida ou algo não funcionou? Conte pra gente: a resposta chega aqui e no seu WhatsApp." />
      ) : (
        <ul className="space-y-2">
          {chamados.map((c) => {
            const st = STATUS[c.status] || { rotulo: c.status, variante: 'neutral' };
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onAbrir(c.id)}
                  className="w-full text-left min-h-11 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-4 py-3 hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--text-main)] break-words">{c.assunto}</span>
                    <Badge variant={st.variante} size="sm">{st.rotulo}</Badge>
                  </span>
                  {c.ultimaMensagem && (
                    <span className="block text-xs text-[var(--text-muted)] mt-1 truncate">
                      {c.ultimaMensagem.autor === 'SUPORTE' ? 'Suporte: ' : 'Você: '}{c.ultimaMensagem.texto}
                    </span>
                  )}
                  <span className="block text-xs text-[var(--text-muted)] mt-0.5">{quando(c.atualizadoEm)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Novo({ onCriado, onVoltar }) {
  const toast = useToast();
  const [assunto, setAssunto] = useState('');
  const [texto, setTexto] = useState('');
  const [campos, setCampos] = useState([]);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api.post('/suporte/chamados', { assunto, texto });
      toast.success('Chamado aberto. A resposta chega aqui e no seu WhatsApp.');
      onCriado(r.data.id);
    } catch (err) {
      setCampos(err.response?.data?.campos || []);
      toast.error(err.response?.data?.erro || 'Não foi possível abrir o chamado.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Button variant="ghost" className="min-h-11 -ml-2" icon={ArrowLeft} onClick={onVoltar}>Voltar</Button>
      <Input label="Assunto" value={assunto} maxLength={120} onChange={(e) => setAssunto(e.target.value)}
        placeholder="Ex.: lembrete não chegou para uma cliente" error={campos.includes('assunto') ? 'Escreva o assunto (3 a 120 letras)' : undefined} />
      <Textarea label="O que aconteceu?" rows={6} value={texto} maxLength={4000} onChange={(e) => setTexto(e.target.value)}
        hint="Conte o que você tentou fazer e o que apareceu na tela."
        error={campos.includes('texto') ? 'Conte o que aconteceu' : undefined} />
      <Button type="submit" className="min-h-11 w-full" icon={Send} loading={enviando}>Enviar para o suporte</Button>
    </form>
  );
}

function Conversa({ chamadoId, onVoltar, somenteLeitura }) {
  const toast = useToast();
  const [chamado, setChamado] = useState(null);
  const [erro, setErro] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => api.get(`/suporte/chamados/${chamadoId}`)
    .then((r) => { setChamado(r.data); setErro(''); })
    .catch((e) => setErro(e.response?.data?.erro || 'Não foi possível abrir a conversa.')), [chamadoId]);

  useEffect(() => { carregar(); }, [carregar]);

  const responder = async (e) => {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await api.post(`/suporte/chamados/${chamadoId}/mensagens`, { texto });
      setTexto('');
      await carregar();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" className="min-h-11 -ml-2" icon={ArrowLeft} onClick={onVoltar}>Meus chamados</Button>
      {erro ? (
        <div role="alert" className="space-y-3 text-sm text-[var(--danger-text)]">
          <p>{erro}</p>
          <Button variant="secondary" className="min-h-11" onClick={carregar}>Tentar de novo</Button>
        </div>
      ) : !chamado ? (
        <div className="h-40 rounded-xl bg-[var(--bg-subtle)] animate-pulse" aria-busy="true" />
      ) : (
        <>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-main)] break-words">{chamado.assunto}</h3>
            <Badge variant={(STATUS[chamado.status] || {}).variante || 'neutral'} size="sm">{(STATUS[chamado.status] || {}).rotulo || chamado.status}</Badge>
          </div>
          <ol className="space-y-3" aria-label="Conversa com o suporte">
            {chamado.mensagens.map((m) => (
              <li key={m.id} className={clsx('max-w-[88%] rounded-2xl px-4 py-2.5', m.autor === 'CLIENTE'
                ? 'ml-auto bg-[var(--primary)] text-[var(--text-on-primary)]'
                : 'bg-[var(--bg-subtle)] text-[var(--text-main)]')}>
                <p className="text-xs font-semibold opacity-80">{m.autor === 'SUPORTE' ? `${m.autorNome} · Suporte Sellergy` : m.autorNome} · {quando(m.criadoEm)}</p>
                <p className="text-sm whitespace-pre-wrap break-words mt-0.5">{m.texto}</p>
              </li>
            ))}
          </ol>
          {!somenteLeitura && (
            <form onSubmit={responder} className="space-y-2">
              <Textarea label={chamado.status === 'RESOLVIDO' ? 'Escrever de novo (reabre o chamado)' : 'Sua mensagem'} rows={3} value={texto} maxLength={4000} onChange={(e) => setTexto(e.target.value)} />
              <Button type="submit" className="min-h-11 w-full" icon={Send} loading={enviando} disabled={!texto.trim()}>Enviar</Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

export default function BotaoAjuda() {
  const somenteLeitura = useAuthStore((s) => Boolean(s.user?.suporte));
  const [params, setParams] = useSearchParams();
  const chamadoDaUrl = params.get('ajuda');
  const [aberto, setAberto] = useState(false);
  const [tela, setTela] = useState({ tipo: 'lista' });
  const [chamados, setChamados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(() => api.get('/suporte/chamados')
    .then((r) => { setChamados(Array.isArray(r.data) ? r.data : []); setErro(''); })
    .catch((e) => setErro(e.response?.data?.erro || 'Não foi possível carregar seus chamados.'))
    .finally(() => setCarregando(false)), []);

  // Link da notificacao (?ajuda=<id>) abre direto na conversa.
  const painelAberto = aberto || Boolean(chamadoDaUrl);
  const telaAtual = chamadoDaUrl ? { tipo: 'conversa', id: chamadoDaUrl } : tela;

  const abrir = () => { setTela({ tipo: 'lista' }); setCarregando(true); setAberto(true); carregar(); };
  const fechar = () => {
    setAberto(false);
    if (chamadoDaUrl) { params.delete('ajuda'); setParams(params, { replace: true }); }
  };
  const voltarLista = () => {
    if (chamadoDaUrl) { params.delete('ajuda'); setParams(params, { replace: true }); }
    setAberto(true);
    setTela({ tipo: 'lista' });
    setCarregando(true);
    carregar();
  };

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-label="Ajuda: falar com o suporte"
        className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 min-h-12 px-4 rounded-full bg-[var(--primary)] text-[var(--text-on-primary)] shadow-lg font-semibold text-sm hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--primary)]"
      >
        <HelpCircle size={20} aria-hidden="true" />
        <span className="hidden sm:inline">Ajuda</span>
      </button>

      <Drawer
        isOpen={painelAberto}
        onClose={fechar}
        fecharAoClicarFora
        title="Ajuda"
        description={somenteLeitura ? 'Sessão de suporte: só leitura.' : 'Fale com o suporte do Sellergy.'}
      >
        {telaAtual.tipo === 'novo' ? (
          <Novo onVoltar={() => setTela({ tipo: 'lista' })} onCriado={(id) => setTela({ tipo: 'conversa', id })} />
        ) : telaAtual.tipo === 'conversa' ? (
          <Conversa key={telaAtual.id} chamadoId={telaAtual.id} onVoltar={voltarLista} somenteLeitura={somenteLeitura} />
        ) : (
          <Lista
            chamados={chamados}
            erro={erro}
            carregando={carregando}
            somenteLeitura={somenteLeitura}
            onAbrir={(id) => setTela({ tipo: 'conversa', id })}
            onNovo={() => setTela({ tipo: 'novo' })}
            onTentar={() => { setCarregando(true); carregar(); }}
          />
        )}
      </Drawer>
    </>
  );
}

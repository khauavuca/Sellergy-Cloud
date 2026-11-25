import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { MessageCircle, RefreshCw, Smartphone } from 'lucide-react';
import { Button, EmptyState, useToast } from '../components/ui';
import ListaConversas from '../components/whatsapp/ListaConversas';
import ConversaAberta from '../components/whatsapp/ConversaAberta';
import FichaCliente from '../components/whatsapp/FichaCliente';
import { useConversasTempoReal } from '../components/whatsapp/useConversasTempoReal';
import { erroDaApi } from '../components/whatsapp/util';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import { usePermissao } from '../hooks/usePermissao';
import { useAuthStore } from '../store/auth.store';
import api from '../services/api';

// Caixa de entrada do WhatsApp: tudo que chega e sai pelo número conectado
// (cliente, bot, lembretes e equipe). 3 colunas no computador (lista,
// conversa, ficha); no celular, uma coluna por vez.
// Backend: routes/conversas.routes.js · tempo real: conversas/tempoReal.js.

const ALTURA = 'min-h-[520px]';

/**
 * Altura que sobra na janela abaixo do topo do bloco (faixas de aviso acima
 * variam: teste grátis, comunicado, suporte). Recalcula ao redimensionar.
 */
function useAlturaRestante() {
  const [altura, setAltura] = useState(null);
  const observar = useCallback((el) => {
    if (!el) return undefined;
    const medir = () => setAltura(Math.max(520, window.innerHeight - el.getBoundingClientRect().top - window.scrollY - 16));
    medir();
    window.addEventListener('resize', medir);
    // Faixa de aviso que aparece depois (carrega sozinha) empurra o bloco pra baixo.
    const obs = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    obs?.observe(document.body);
    return () => { window.removeEventListener('resize', medir); obs?.disconnect(); }; // limpeza do ref (React 19)
  }, []);
  return [altura, observar];
}

/** Junta/atualiza uma conversa na lista, mais recente primeiro. */
function mesclarConversa(lista, nova) {
  const i = lista.findIndex((c) => c.id === nova.id);
  if (i < 0) return null; // não está carregada: quem chamou recarrega a lista
  const atual = { ...lista[i], ...nova, nome: lista[i].nome || nova.nome };
  const resto = lista.filter((c) => c.id !== nova.id);
  return [atual, ...resto].sort((a, b) => new Date(b.ultimaMensagemEm) - new Date(a.ultimaMensagemEm));
}

export default function WhatsAppPage() {
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const podeResponder = usePermissao('CRM', 'editar');
  const [params, setParams] = useSearchParams();
  const selecionadaId = params.get('c');

  const [canal, setCanal] = useState(null);
  const [atalhos, setAtalhos] = useState(null);
  const [lista, setLista] = useState({ conversas: [], contagens: null, proximo: null });
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [detalhe, setDetalhe] = useState(null);
  // Mensagens guardadas com o id da conversa: trocar de conversa não mostra as da anterior.
  const [mensagens, setMensagens] = useState({ conversaId: null, itens: [], proximo: null, temMais: false });
  const carregandoMsgs = Boolean(selecionadaId) && mensagens.conversaId !== selecionadaId;
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [painel, setPainel] = useState(selecionadaId ? 'conversa' : 'lista'); // celular: uma coluna por vez
  const [altura, refAltura] = useAlturaRestante();
  const selecionadaRef = useRef(selecionadaId);
  useEffect(() => { selecionadaRef.current = selecionadaId; }, [selecionadaId]);

  // Busca com espera curta (não consulta a cada tecla).
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregarCanal = useCallback(() => {
    api.get('/conversas/canal').then((r) => setCanal(r.data)).catch(() => setCanal({ conectado: false, erro: true }));
  }, []);

  const carregarLista = useCallback(async ({ mais = false } = {}) => {
    if (mais) setCarregandoMais(true); else setCarregandoLista(true);
    try {
      const r = await api.get('/conversas', {
        params: { busca: buscaAtiva || undefined, filtro, antes: mais ? lista.proximo : undefined },
      });
      setLista((l) => ({
        conversas: mais ? [...l.conversas, ...r.data.conversas] : r.data.conversas,
        contagens: r.data.contagens,
        proximo: r.data.proximo,
      }));
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível carregar as conversas.'));
    } finally {
      setCarregandoLista(false);
      setCarregandoMais(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaAtiva, filtro, lista.proximo]);

  useAcaoTopo(
    <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => carregarLista()}>Atualizar</Button>,
    [carregarLista]
  );

  useEffect(() => {
    carregarCanal();
    api.get('/conversas/atalhos').then((r) => setAtalhos(r.data)).catch(() => setAtalhos(null));
  }, [carregarCanal]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca ao abrir e ao mudar filtro/busca
    carregarLista();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaAtiva, filtro]);

  // Conversa aberta: detalhe + última página de mensagens + marca como lida.
  useEffect(() => {
    if (!selecionadaId) return undefined;
    let vivo = true;
    Promise.all([api.get(`/conversas/${selecionadaId}`), api.get(`/conversas/${selecionadaId}/mensagens`)])
      .then(([d, m]) => {
        if (!vivo) return;
        setDetalhe(d.data);
        setMensagens({ conversaId: selecionadaId, itens: m.data.mensagens, proximo: m.data.proximo, temMais: m.data.temMais });
        if (d.data.conversa.naoLidas > 0) {
          api.post(`/conversas/${selecionadaId}/lida`).catch(() => {});
          setLista((l) => ({ ...l, conversas: l.conversas.map((c) => (c.id === selecionadaId ? { ...c, naoLidas: 0 } : c)) }));
        }
      })
      .catch((e) => {
        if (!vivo) return;
        toast.error(erroDaApi(e, 'Não foi possível abrir a conversa.'));
        setParams({}, { replace: true });
      });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionadaId]);

  const selecionar = (id) => {
    setParams({ c: id });
    setPainel('conversa');
  };

  const carregarAntigas = async () => {
    if (!selecionadaId || !mensagens.proximo) return;
    setCarregandoAntigas(true);
    try {
      const r = await api.get(`/conversas/${selecionadaId}/mensagens`, { params: { antes: mensagens.proximo } });
      setMensagens((m) => ({ itens: [...r.data.mensagens, ...m.itens], proximo: r.data.proximo, temMais: r.data.temMais }));
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível carregar as mensagens anteriores.'));
    } finally {
      setCarregandoAntigas(false);
    }
  };

  const aplicarConversa = useCallback((conversa) => {
    let recarregar = false;
    setLista((l) => {
      const nova = mesclarConversa(l.conversas, conversa);
      if (!nova) { recarregar = true; return l; }
      return { ...l, conversas: nova };
    });
    setDetalhe((d) => (d && d.conversa.id === conversa.id ? { ...d, conversa: { ...d.conversa, ...conversa, nome: d.conversa.nome } } : d));
    return recarregar;
  }, []);

  // ---------- tempo real ----------
  useConversasTempoReal({
    ativo: Boolean(canal),
    onImportadas: () => { carregarLista(); },
    onMensagem: ({ conversa, mensagem }) => {
      const aberta = selecionadaRef.current === conversa.id;
      if (aberta) {
        setMensagens((m) => (m.conversaId !== conversa.id || m.itens.some((x) => x.id === mensagem.id) ? m : { ...m, itens: [...m.itens, mensagem] }));
        if (mensagem.direcao === 'ENTRADA') {
          api.post(`/conversas/${conversa.id}/lida`).catch(() => {});
          conversa = { ...conversa, naoLidas: 0 };
        }
      }
      if (aplicarConversa(conversa)) carregarLista();
      setCanal((c) => (c && mensagem.direcao === 'ENTRADA' && !aberta ? { ...c, naoLidas: (c.naoLidas || 0) + 1 } : c));
    },
    onStatus: ({ mensagem }) => {
      setMensagens((m) => ({ ...m, itens: m.itens.map((x) => (x.id === mensagem.id ? { ...x, ...mensagem } : x)) }));
    },
    onConversa: ({ conversa }) => aplicarConversa(conversa),
  });

  // ---------- ações ----------
  const enviar = async (texto) => {
    try {
      const r = await api.post(`/conversas/${selecionadaId}/mensagens`, { texto });
      setMensagens((m) => (m.itens.some((x) => x.id === r.data.mensagem.id) ? m : { ...m, itens: [...m.itens, r.data.mensagem] }));
      aplicarConversa(r.data.conversa);
      return true;
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível enviar.'));
      if (e?.response?.data?.codigo === 'WHATSAPP_DESCONECTADO') carregarCanal();
      return false;
    }
  };

  const pausar = async (horas) => {
    try {
      const r = await api.post(`/conversas/${selecionadaId}/pausar`, { horas });
      aplicarConversa(r.data.conversa);
      toast.success('Conversa com a equipe: o bot não responde aqui.');
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível pausar o bot.'));
    }
  };

  const retomar = async () => {
    try {
      const r = await api.post(`/conversas/${selecionadaId}/retomar`);
      aplicarConversa(r.data.conversa);
      toast.success('Conversa devolvida ao bot.');
    } catch (e) {
      toast.error(erroDaApi(e, 'Não foi possível devolver ao bot.'));
    }
  };

  // ---------- estados vazios ----------
  if (!canal || (carregandoLista && !lista.contagens)) {
    return <div className={clsx(ALTURA, 'rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] animate-pulse')} aria-busy="true" />;
  }

  if (!canal.conectado && !lista.contagens?.todas && !buscaAtiva) {
    return (
      <div className="rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)]">
        <EmptyState
          icon={Smartphone}
          title="Conecte o WhatsApp do negócio"
          description="Depois de conectar o número (oficial ou por QR Code), as conversas com seus clientes aparecem aqui: você lê, responde e assume a conversa quando o bot não der conta."
          action={(
            <Link
              to="/app/bots"
              className="h-10 px-4 rounded-lg inline-flex items-center gap-2 text-sm font-semibold bg-[var(--primary)] text-[var(--text-on-primary)] hover:bg-[var(--primary-hover)] no-underline"
            >
              <MessageCircle size={16} aria-hidden="true" />
              Ir para Bots e conexão
            </Link>
          )}
        />
      </div>
    );
  }

  const conversaAberta = detalhe?.conversa && detalhe.conversa.id === selecionadaId ? detalhe.conversa : null;
  const canalDaConversa = detalhe?.canal ? { ...canal, ...detalhe.canal } : canal;

  return (
    <div ref={refAltura} className={clsx(ALTURA, 'flex gap-4 min-w-0')} style={altura ? { height: altura } : { height: 'calc(100dvh - 140px)' }}>
      <ListaConversas
        className={clsx('w-full lg:w-[320px] lg:flex-none', painel !== 'lista' && 'max-lg:hidden')}
        conversas={lista.conversas}
        contagens={lista.contagens}
        carregando={carregandoLista}
        temMais={Boolean(lista.proximo)}
        carregandoMais={carregandoMais}
        onMais={() => carregarLista({ mais: true })}
        busca={busca}
        onBusca={setBusca}
        filtro={filtro}
        onFiltro={setFiltro}
        selecionadaId={selecionadaId}
        onSelecionar={selecionar}
        canal={canal}
      />
      <ConversaAberta
        // celular: só no painel "conversa"; tablet: some quando a ficha abre; computador largo: sempre.
        className={clsx('flex-1', painel === 'lista' && 'max-lg:hidden', painel === 'ficha' && 'max-xl:hidden')}
        conversa={conversaAberta}
        canal={canalDaConversa}
        atalhos={atalhos}
        mensagens={conversaAberta && mensagens.conversaId === conversaAberta.id ? mensagens.itens : []}
        carregando={carregandoMsgs}
        temMais={mensagens.temMais}
        carregandoMais={carregandoAntigas}
        onMais={carregarAntigas}
        onEnviar={enviar}
        onMensagem={(mensagem) => mensagem && setMensagens((m) => (m.itens.some((x) => x.id === mensagem.id) ? m : { ...m, itens: [...m.itens, mensagem] }))}
        onPausar={pausar}
        onRetomar={retomar}
        onVoltar={() => setPainel('lista')}
        onFicha={() => setPainel('ficha')}
        podeResponder={podeResponder}
      />
      {conversaAberta && (
        <FichaCliente
          className={clsx('w-full flex-1 xl:w-[300px] xl:flex-none', painel !== 'ficha' && 'max-xl:hidden')}
          conversa={conversaAberta}
          ficha={detalhe.ficha}
          respostasDoBotHoje={detalhe.respostasDoBotHoje}
          modulos={user?.modulosLiberados}
          onVoltar={() => setPainel('conversa')}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Link } from 'react-router-dom';
import {
  Bot as BotIcon, Plus, WifiOff, ShieldAlert, QrCode, ArrowLeft, Repeat, MessageCircle, Settings2,
} from 'lucide-react';
import {
  Button, Badge, EmptyState, useToast, Pagina, Painel,
} from '../components/ui';
import CartaoConexao from '../components/bots/CartaoConexao';
import PassoAPassoOficial from '../components/bots/PassoAPassoOficial';
import PainelBotAtendimento from '../components/bots/PainelBotAtendimento';
import PainelPerguntasBot from '../components/bots/PainelPerguntasBot';
import { useAcaoTopo } from '../hooks/useAcaoTopo';
import api, { urlPublica } from '../services/api';
import credenciaisService from '../services/credenciaisService';
import faqService from '../services/faqService';
import { useAuthStore } from '../store/auth.store';

// Rotulos humanos do status tecnico de pareamento Baileys (StatusConexaoBaileys).
const STATUS_BAILEYS_LABEL = {
  DESCONECTADO: 'Desconectado',
  AGUARDANDO_QR: 'Aguardando leitura do QR Code',
  CONECTANDO: 'Conectando...',
  CONECTADO: 'Conectado',
  LOGOUT: 'Sessão encerrada — escaneie o QR de novo',
};
const STATUS_BAILEYS_VARIANT = {
  DESCONECTADO: 'neutral',
  AGUARDANDO_QR: 'warning',
  CONECTANDO: 'warning',
  CONECTADO: 'success',
  LOGOUT: 'danger',
};
// Mesmo status, no tom do ponto de situacao do cartao.
const TOM_POR_VARIANT = { neutral: 'neutro', warning: 'alerta', success: 'sucesso', danger: 'perigo' };
const ID_PASSO_OFICIAL = 'passo-oficial';

// Tela do tenant pro bot WhatsApp, em 3 momentos:
//   1. Escolher o modo: dois cartoes (oficial Meta x numero por QR Code).
//      Nada de configuracao aparece antes da escolha.
//   2. Conectar: so o processo do modo escolhido (QR Code na tela, ou o
//      passo a passo da Meta com os campos tecnicos).
//   3. Conectado: cartao com o status do numero e "Trocar de modo"; abaixo,
//      o atendimento do bot (ligar/desligar, IA ou menu de perguntas,
//      consumo), igual nos dois modos.
// IA e menu de perguntas nao coexistem em runtime (ver
// webhooksWhatsapp.routes.js: com iaAtiva, o FAQ nem e consultado).
const TIPO_CRED_WHATSAPP = 'WHATSAPP_CLOUD_TOKEN';

const TAM_MAX_PROMPT_IA = 4000;

// Espelha o registro de backend/src/services/iaFerramentas — cada chave
// precisa existir la pra ser aceita pelo PUT /bots/:id.
const ACOES_BOT_DISPONIVEIS = [
  {
    chave: 'CONSULTAR_ESTOQUE',
    titulo: 'Consultar estoque e preço',
    descricao: 'O bot confere se um produto tem estoque disponível e informa o preço quando o cliente perguntar.',
  },
  {
    chave: 'COBRANCA_PIX',
    titulo: 'Gerar cobrança Pix',
    descricao: 'O bot gera um Pix quando o cliente confirmar a compra. A venda e a baixa no estoque acontecem sozinhas assim que o pagamento é confirmado.',
  },
  {
    chave: 'CATALOGO',
    titulo: 'Enviar catálogo em PDF',
    descricao: 'O bot monta e envia o catálogo completo de produtos quando o cliente pedir para ver o que a loja vende.',
  },
];

function tempoRelativo(dataIso) {
  if (!dataIso) return '—';
  const diff = (Date.now() - new Date(dataIso).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'ontem';
  return `há ${Math.floor(diff / 86400)} dias`;
}

function gerarVerifyToken() {
  let s = '';
  const arr = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(arr);
  for (const b of arr) s += b.toString(16).padStart(2, '0');
  return s;
}

export default function BotsClientePage() {
  const toast = useToast();
  const { user } = useAuthStore();
  const [bot, setBot] = useState(null);
  const [credenciais, setCredenciais] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvandoCanal, setSalvandoCanal] = useState(false);
  // Modo escolhido enquanto nao conectou: 'OFICIAL' | 'QR' | 'ESCOLHER'
  // (pediu pra ver a escolha de novo). null = retoma o que estava em andamento.
  const [modoEscolhido, setModoEscolhido] = useState(null);
  // Conectado e querendo trocar de modo.
  const [trocandoModo, setTrocandoModo] = useState(false);
  // Conectado no oficial: abre os dados tecnicos (passo a passo) sob demanda.
  const [verDadosOficial, setVerDadosOficial] = useState(false);
  const [conexao, setConexao] = useState({ credencialCanalId: '', identificadorCanal: '', verifyTokenCanal: '' });
  const [conectandoBaileys, setConectandoBaileys] = useState(false);
  const [desconectandoBaileys, setDesconectandoBaileys] = useState(false);
  const [statusBaileys, setStatusBaileys] = useState({ statusConexaoBaileys: null, qrCodeAtual: null, baileysNumeroConectado: null });
  const [novaFaq, setNovaFaq] = useState({ pergunta: '', resposta: '', palavrasChave: '' });
  const [editandoChaves, setEditandoChaves] = useState({}); // { [faqId]: texto em edicao }
  const [iaForm, setIaForm] = useState({ iaPromptSistema: '', acoesPermitidas: [] });
  const [salvandoIA, setSalvandoIA] = useState(false);
  const [consumoIA, setConsumoIA] = useState(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const [bots, creds, listaFaq] = await Promise.all([
        api.get('/bots').then((r) => r.data).catch(() => []),
        credenciaisService.listar().catch(() => []),
        faqService.listar().catch(() => []),
      ]);
      const b = Array.isArray(bots) ? bots[0] : null;
      setBot(b || null);
      setCredenciais(creds || []);
      setFaqs(listaFaq || []);
      if (b) {
        setConexao({
          // No provedor BAILEYS esse campo guarda a sessao do WhatsApp Web, nao
          // o token da Meta: nao pre-preenche o passo a passo do oficial com ela.
          credencialCanalId: (b.provedorCanal || 'META_CLOUD') === 'META_CLOUD' ? (b.credencialCanalId || '') : '',
          identificadorCanal: b.identificadorCanal || '',
          verifyTokenCanal: b.verifyTokenCanal || '',
        });
        setIaForm({
          iaPromptSistema: b.iaPromptSistema || '',
          acoesPermitidas: Array.isArray(b.acoesPermitidas) ? b.acoesPermitidas : [],
        });
        setStatusBaileys({
          statusConexaoBaileys: b.statusConexaoBaileys || null,
          qrCodeAtual: b.qrCodeAtual || null,
          baileysNumeroConectado: b.baileysNumeroConectado || null,
        });
      }
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    carregar();
  }, []);

  // Socket.io enquanto o modo QR Code esta em jogo (escolhido ou em uso) — o
  // QR/status do pareamento Baileys chega em tempo real pela sala do proprio
  // bot (ver backend/src/index.js: relay Redis -> socket.io -> sala bot:<id>).
  const acompanharQr = !!bot?.id && (modoEscolhido === 'QR' || bot?.provedorCanal === 'BAILEYS');
  useEffect(() => {
    if (!acompanharQr) return;

    const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:3333', {
      withCredentials: true,
      // Sem isso, o polling do socket.io cai na pagina de aviso do ngrok-free
      // (ERR_NGROK_6024) em vez de chegar no backend — o axios ja manda esse
      // header (services/api.js), mas o socket.io-client faz sua propria
      // requisicao, por fora do axios.
      extraHeaders: { 'ngrok-skip-browser-warning': 'true' },
    });
    socket.emit('join_bot', bot.id);
    socket.on('baileys_status', (dados) => setStatusBaileys((s) => ({ ...s, ...dados })));

    // Semeia o estado atual (o socket so avisa sobre MUDANCAS futuras).
    api.get(`/bots/${bot.id}/canal/baileys/status`).then((r) => setStatusBaileys(r.data)).catch(() => {});

    return () => socket.disconnect();
  }, [acompanharQr, bot?.id]);

  const conectarBaileys = async () => {
    if (!bot) return;
    setConectandoBaileys(true);
    try {
      await api.post(`/bots/${bot.id}/canal/baileys/conectar`);
      // O backend ja trocou o provedor do bot pra BAILEYS.
      setBot((b) => ({ ...b, provedorCanal: 'BAILEYS' }));
      toast.success('Pareamento iniciado — aguarde o QR Code aparecer.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao iniciar a conexão.');
    } finally {
      setConectandoBaileys(false);
    }
  };

  const desconectarBaileys = async ({ semPerguntar = false } = {}) => {
    if (!bot) return;
    if (!semPerguntar && !window.confirm('Desconectar o WhatsApp Web? Vai precisar escanear o QR de novo pra reconectar.')) return;
    setDesconectandoBaileys(true);
    try {
      await api.post(`/bots/${bot.id}/canal/baileys/desconectar`);
      if (!semPerguntar) toast.success('Desconectado.');
      // Rele o status pra atualizar o cartao (o socket tambem avisa).
      api.get(`/bots/${bot.id}/canal/baileys/status`).then((r) => setStatusBaileys(r.data)).catch(() => {});
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao desconectar.');
    } finally {
      setDesconectandoBaileys(false);
    }
  };

  // Consumo de IA do mes — so faz sentido buscar quando o bot tem IA ligada.
  useEffect(() => {
    if (!bot?.id || !bot.iaAtiva) return;
    api.get(`/bots/${bot.id}/consumo-ia`)
      .then((r) => setConsumoIA(r.data))
      .catch(() => setConsumoIA(null));
  }, [bot?.id, bot?.iaAtiva]);

  const credsWhatsapp = credenciais.filter((c) => c.tipo === TIPO_CRED_WHATSAPP);
  const online = bot?.status === 'ONLINE';
  // Rota compartilhada por todos os bots (nao tem segmento de botId) — quem
  // identifica o bot e o verify token (na verificacao) e o phoneNumberId (nas
  // mensagens). Ver backend/src/routes/webhooksWhatsapp.routes.js.
  const urlWebhook = `${urlPublica()}/webhooks/whatsapp`;

  const copiar = (texto, label) => {
    navigator.clipboard?.writeText(texto).then(
      () => toast.success(`${label} copiado.`),
      () => toast.error('Falha ao copiar.'),
    );
  };

  const criarBot = async () => {
    try {
      const r = await api.post('/bots', { nome: 'WhatsApp', canal: 'WHATSAPP' });
      setBot(r.data);
      toast.success('Bot criado. Siga o passo a passo para conectar o WhatsApp.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao criar bot.');
    }
  };

  const salvarCanal = async () => {
    if (!bot) return;
    setSalvandoCanal(true);
    try {
      // Trocando do QR Code pro oficial: solta o WhatsApp Web antes, pra o
      // bot nao ficar com dois numeros respondendo.
      if (bot.provedorCanal === 'BAILEYS' && statusBaileys.statusConexaoBaileys === 'CONECTADO') {
        await desconectarBaileys({ semPerguntar: true });
      }
      const r = await api.patch(`/bots/${bot.id}/canal`, {
        canal: 'WHATSAPP',
        provedorCanal: 'META_CLOUD',
        credencialCanalId: conexao.credencialCanalId || null,
        identificadorCanal: conexao.identificadorCanal.trim() || null,
        verifyTokenCanal: conexao.verifyTokenCanal.trim() || null,
      });
      setBot((b) => ({ ...b, ...r.data }));
      toast.success('Conexão salva.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao salvar conexão.');
    } finally {
      setSalvandoCanal(false);
    }
  };

  const alternarStatus = async () => {
    if (!bot) return;
    const novo = online ? 'OFFLINE' : 'ONLINE';
    try {
      const r = await api.patch(`/bots/${bot.id}/status`, { status: novo });
      setBot((b) => ({ ...b, ...r.data }));
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao mudar status.');
    }
  };

  const alternarAcaoBot = (chave) => {
    setIaForm((f) => ({
      ...f,
      acoesPermitidas: f.acoesPermitidas.includes(chave)
        ? f.acoesPermitidas.filter((a) => a !== chave)
        : [...f.acoesPermitidas, chave],
    }));
  };

  const salvarIA = async () => {
    if (!bot) return;
    setSalvandoIA(true);
    try {
      const r = await api.put(`/bots/${bot.id}`, {
        iaPromptSistema: iaForm.iaPromptSistema.trim() || null,
        acoesPermitidas: iaForm.acoesPermitidas,
      });
      setBot((b) => ({ ...b, ...r.data }));
      toast.success('Configuração da IA salva.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao salvar a configuração da IA.');
    } finally {
      setSalvandoIA(false);
    }
  };

  const adicionarFaq = async () => {
    if (!novaFaq.pergunta.trim() || !novaFaq.resposta.trim()) return toast.error('Preencha pergunta e resposta.');
    try {
      const palavrasChave = novaFaq.palavrasChave
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const f = await faqService.criar({
        pergunta: novaFaq.pergunta, resposta: novaFaq.resposta, ordem: faqs.length, palavrasChave,
      });
      setFaqs((l) => [...l, f]);
      setNovaFaq({ pergunta: '', resposta: '', palavrasChave: '' });
      toast.success('Pergunta adicionada.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao adicionar.');
    }
  };

  const alternarFaqAtivo = async (f) => {
    try {
      const at = await faqService.atualizar(f.id, { ativo: !f.ativo });
      setFaqs((l) => l.map((x) => (x.id === f.id ? at : x)));
    } catch {
      toast.error('Falha ao atualizar.');
    }
  };

  const salvarChaves = async (f) => {
    const texto = editandoChaves[f.id] ?? '';
    const palavrasChave = texto.split(',').map((p) => p.trim()).filter(Boolean);
    try {
      const at = await faqService.atualizar(f.id, { palavrasChave });
      setFaqs((l) => l.map((x) => (x.id === f.id ? at : x)));
      setEditandoChaves((e) => { const n = { ...e }; delete n[f.id]; return n; });
      toast.success('Palavras-chave salvas.');
    } catch {
      toast.error('Falha ao salvar palavras-chave.');
    }
  };

  const excluirFaq = async (f) => {
    if (!window.confirm(`Excluir "${f.pergunta}"?`)) return;
    try {
      await faqService.excluir(f.id);
      setFaqs((l) => l.filter((x) => x.id !== f.id));
    } catch {
      toast.error('Falha ao excluir.');
    }
  };

  // Topo: sem bot, cria; conectado, atalho pras conversas.
  const conectadoTopo = !!bot && (
    ((bot.provedorCanal || 'META_CLOUD') === 'META_CLOUD' && !!bot.identificadorCanal && !!bot.credencialCanalId && !!bot.verifyTokenCanal)
    || (bot.provedorCanal === 'BAILEYS' && statusBaileys.statusConexaoBaileys === 'CONECTADO')
  );
  useAcaoTopo(
    !bot
      ? (carregando ? null : <Button size="sm" icon={Plus} onClick={criarBot}>Criar bot</Button>)
      : conectadoTopo
        ? (
          <Link
            to="/app/whatsapp"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold bg-[var(--primary)] text-white hover:opacity-90"
          >
            <MessageCircle size={15} aria-hidden="true" /> Ver conversas
          </Link>
        )
        : null,
    [bot?.id, carregando, conectadoTopo],
  );

  // QR Code lido durante uma troca de modo: termina a troca sozinho.
  useEffect(() => {
    if (modoEscolhido === 'QR' && statusBaileys.statusConexaoBaileys === 'CONECTADO') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reage ao status do socket
      setModoEscolhido(null);
      setTrocandoModo(false);
      toast.success('WhatsApp conectado.');
    }
  }, [modoEscolhido, statusBaileys.statusConexaoBaileys]); // eslint-disable-line react-hooks/exhaustive-deps

  if (carregando) {
    return <div className="text-sm text-[var(--text-muted)] py-10 text-center">Carregando...</div>;
  }

  if (!bot) {
    return (
      <Pagina>
        <Painel titulo="Bot do WhatsApp">
          <EmptyState
            icon={BotIcon}
            title="Nenhum bot ainda"
            description="Crie o bot do seu WhatsApp para escolher como conectar o número e configurar o atendimento."
            action={<Button variant="primary" icon={Plus} onClick={criarBot}>Criar bot</Button>}
          />
        </Painel>
      </Pagina>
    );
  }

  const baileysLiberado = !!user?.modulosLiberados?.WHATSAPP_BAILEYS;
  // O bot usa um provedor por vez: salvar o oficial volta pra META_CLOUD;
  // conectar por QR troca pra BAILEYS (ver bots.routes.js).
  const ehOficial = (bot.provedorCanal || 'META_CLOUD') === 'META_CLOUD';
  const oficialConfigurado = ehOficial && !!bot.identificadorCanal && !!bot.credencialCanalId && !!bot.verifyTokenCanal;
  const stBaileys = statusBaileys.statusConexaoBaileys;
  const baileysConectado = !ehOficial && stBaileys === 'CONECTADO';
  const conectado = oficialConfigurado || baileysConectado;
  const modoAtual = oficialConfigurado ? 'OFICIAL' : baileysConectado ? 'QR' : null;

  // Sem escolha explicita, retoma o que ja estava em andamento: QR pedido
  // (provedor BAILEYS) ou oficial comecado (algum campo tecnico salvo).
  const modoEmAndamento = !ehOficial
    ? 'QR'
    : (bot.identificadorCanal || bot.credencialCanalId || bot.verifyTokenCanal) ? 'OFICIAL' : null;
  const modoConectando = conectado
    ? (trocandoModo ? modoEscolhido : null)
    : (modoEscolhido || modoEmAndamento);

  const escolher = (modo) => {
    setModoEscolhido(modo);
    setTrocandoModo(conectado);
  };
  const voltarEscolha = () => {
    // Volta pra escolha de modo; o que ja foi salvo continua salvo.
    setModoEscolhido(conectado ? null : 'ESCOLHER');
    setTrocandoModo(conectado);
  };
  const cancelarTroca = () => {
    setTrocandoModo(false);
    setModoEscolhido(null);
  };

  const cartaoOficial = (acoes) => (
    <CartaoConexao
      id="conexao-oficial"
      titulo="WhatsApp oficial (Meta)"
      etiqueta={<Badge variant="success" size="sm">Recomendado</Badge>}
      itens={[
        { texto: 'Conexão aprovada pela Meta, sem risco de bloqueio do número', tipo: 'ok' },
        { texto: 'Campanhas e avisos com modelos de mensagem aprovados', tipo: 'ok' },
        { texto: 'Funciona com o celular desligado', tipo: 'ok' },
      ]}
      rodape="Cobrado por mensagem pela Meta. Precisa do Gerenciador de Negócios da Meta."
      acoes={acoes}
    />
  );
  const cartaoQr = (acoes) => (
    <CartaoConexao
      id="conexao-qr"
      titulo="Número do negócio por QR Code"
      etiqueta={<Badge variant="neutral" size="sm">Não oficial</Badge>}
      itens={[
        { texto: 'Conecta em 1 minuto, igual WhatsApp Web', tipo: 'ok' },
        { texto: 'Clientes falam com o número que já conhecem', tipo: 'ok' },
        { texto: 'Não passa pela Meta: use com moderação', tipo: 'aviso' },
        { texto: 'Risco real de banimento do número em disparo de mensagens em massa', tipo: 'nao' },
      ]}
      rodape={baileysLiberado || modoAtual === 'QR' ? undefined : 'Este modo precisa ser liberado pelo administrador do Sellergy.'}
      acoes={acoes}
    />
  );

  // ---------- Passo 1: escolher o modo ----------
  const mostrarEscolha = (!conectado && (!modoConectando || modoConectando === 'ESCOLHER'))
    || (conectado && trocandoModo && !modoEscolhido);
  if (mostrarEscolha) {
    return (
      <Pagina>
        <Painel
          titulo={conectado ? 'Trocar o modo de conexão' : 'Passo 1 de 2 · Como quer conectar o WhatsApp?'}
          subtitulo={conectado
            ? `Hoje o bot usa ${modoAtual === 'OFICIAL' ? 'o WhatsApp oficial' : 'o número por QR Code'}. Ele continua funcionando até você concluir a troca.`
            : 'Escolha um modo. Depois aparece só o passo a passo dele.'}
          acoes={conectado ? <Button variant="secondary" size="sm" icon={ArrowLeft} onClick={cancelarTroca}>Cancelar</Button> : null}
        >
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}>
            {cartaoOficial(
              modoAtual === 'OFICIAL'
                ? <Badge variant="success" size="sm">Em uso</Badge>
                : <Button variant="primary" size="sm" onClick={() => escolher('OFICIAL')}>Usar o oficial</Button>,
            )}
            {cartaoQr(
              modoAtual === 'QR'
                ? <Badge variant="success" size="sm">Em uso</Badge>
                : (
                  <Button variant="secondary" size="sm" icon={QrCode} onClick={() => escolher('QR')} disabled={!baileysLiberado}>
                    Usar QR Code
                  </Button>
                ),
            )}
          </div>
        </Painel>
      </Pagina>
    );
  }

  // ---------- Passo 2: conectar o modo escolhido ----------
  if (modoConectando === 'OFICIAL' || modoConectando === 'QR') {
    const ehQr = modoConectando === 'QR';
    return (
      <Pagina>
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--border-main)] bg-[var(--bg-card)] px-4 py-3">
          <Button variant="secondary" size="sm" icon={ArrowLeft} onClick={voltarEscolha}>Trocar modo</Button>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-[var(--text-muted)]">{conectado ? 'Trocando o modo' : 'Passo 2 de 2'}</div>
            <div className="text-sm font-bold text-[var(--text-main)]">
              {ehQr ? 'Conectar o número por QR Code' : 'Conectar o WhatsApp oficial (Meta)'}
            </div>
          </div>
          {conectado && (
            <span className="text-xs text-[var(--text-muted)]">
              O {modoAtual === 'OFICIAL' ? 'oficial' : 'QR Code'} continua respondendo até a troca terminar.
            </span>
          )}
        </div>

        {ehQr ? (
          <Painel titulo="Número do negócio por QR Code" subtitulo="Conecte o WhatsApp do celular ao bot, como no WhatsApp Web.">
            <div className="flex flex-col gap-4 max-w-[560px]">
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--warning-soft)]">
                <ShieldAlert size={16} className="text-[var(--warning)] flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p className="m-0 text-xs text-[var(--warning-text)] leading-relaxed">
                  Conexão não oficial: não passa pela Meta e tem risco real de banimento do número, principalmente em disparo de mensagens em massa. Use com moderação.
                </p>
              </div>

              {!ehOficial && stBaileys && (
                <div>
                  <Badge variant={STATUS_BAILEYS_VARIANT[stBaileys] || 'neutral'} size="sm">
                    {STATUS_BAILEYS_LABEL[stBaileys] || stBaileys}
                    {statusBaileys.baileysNumeroConectado ? ` · +${statusBaileys.baileysNumeroConectado}` : ''}
                  </Badge>
                </div>
              )}

              {!ehOficial && statusBaileys.qrCodeAtual && stBaileys !== 'CONECTADO' ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <img src={statusBaileys.qrCodeAtual} alt="QR Code do WhatsApp Web" className="w-56 h-56 border border-[var(--border-main)] rounded-lg bg-white" />
                  <p className="m-0 text-xs text-[var(--text-muted)] text-center">
                    No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → aponte para o QR.
                  </p>
                </div>
              ) : (
                <ol className="m-0 pl-5 text-[13px] text-[var(--text-secondary)] flex flex-col gap-1.5">
                  <li>Clique em “Gerar QR Code”.</li>
                  <li>No celular, abra o WhatsApp → Aparelhos conectados → Conectar um aparelho.</li>
                  <li>Aponte a câmera para o QR que aparece aqui. Pronto.</li>
                </ol>
              )}

              {!(stBaileys === 'CONECTADO' && !ehOficial) && (
                <div>
                  <Button variant="primary" icon={QrCode} onClick={conectarBaileys} loading={conectandoBaileys}>
                    {!ehOficial && statusBaileys.qrCodeAtual ? 'Gerar outro QR Code' : 'Gerar QR Code'}
                  </Button>
                </div>
              )}
              {conectado && modoAtual === 'OFICIAL' && (
                <p className="m-0 text-xs text-[var(--text-muted)]">
                  Ao gerar o QR Code, o bot deixa de usar o número oficial e passa a responder por este número.
                </p>
              )}
            </div>
          </Painel>
        ) : (
          <PassoAPassoOficial
            key={bot.id}
            id={ID_PASSO_OFICIAL}
            bot={bot}
            conexao={conexao}
            setConexao={setConexao}
            credsWhatsapp={credsWhatsapp}
            urlWebhook={urlWebhook}
            copiar={copiar}
            gerarVerifyToken={gerarVerifyToken}
            salvarCanal={async () => { await salvarCanal(); setTrocandoModo(false); setModoEscolhido(null); }}
            salvandoCanal={salvandoCanal}
          />
        )}
      </Pagina>
    );
  }

  // ---------- Conectado: status do número + atendimento do bot ----------
  const numeroQr = statusBaileys.baileysNumeroConectado ? `+${statusBaileys.baileysNumeroConectado}` : 'número conectado';
  return (
    <Pagina>
      <Painel
        titulo={modoAtual === 'OFICIAL' ? 'WhatsApp oficial (Meta)' : 'Número do negócio por QR Code'}
        acoes={(
          <>
            <Badge variant="success" size="sm">Conectado</Badge>
            <Button variant="secondary" size="sm" icon={Repeat} onClick={() => { setTrocandoModo(true); setModoEscolhido(null); }}>
              Trocar de modo
            </Button>
          </>
        )}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-main)] min-w-0 flex-1">
            <span className="w-2 h-2 rounded-full bg-[var(--success)] flex-shrink-0" aria-hidden="true" />
            <strong>Conectado</strong>
            <span className="text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">
              · {modoAtual === 'OFICIAL' ? `Phone Number ID ${bot.identificadorCanal}` : numeroQr}
            </span>
          </div>
          {modoAtual === 'OFICIAL' ? (
            <Button variant="secondary" size="sm" icon={Settings2} onClick={() => setVerDadosOficial((v) => !v)}>
              {verDadosOficial ? 'Esconder dados técnicos' : 'Dados técnicos'}
            </Button>
          ) : (
            <Button variant="danger-soft" size="sm" icon={WifiOff} onClick={() => desconectarBaileys()} loading={desconectandoBaileys}>
              Desconectar
            </Button>
          )}
        </div>
        {modoAtual === 'QR' && (
          <p className="m-0 mt-3 text-xs text-[var(--text-muted)]">
            Modo não oficial: evite disparos em massa para não arriscar o número.
          </p>
        )}
      </Painel>

      {modoAtual === 'OFICIAL' && verDadosOficial && (
        <PassoAPassoOficial
          key={bot.id}
          id={ID_PASSO_OFICIAL}
          bot={bot}
          conexao={conexao}
          setConexao={setConexao}
          credsWhatsapp={credsWhatsapp}
          urlWebhook={urlWebhook}
          copiar={copiar}
          gerarVerifyToken={gerarVerifyToken}
          salvarCanal={salvarCanal}
          salvandoCanal={salvandoCanal}
        />
      )}

      {/* Atendimento do bot: vem logo abaixo da conexão (no celular, antes do menu de perguntas). */}
      <div className={bot.iaAtiva ? 'flex flex-col gap-4' : 'grid gap-4 items-start lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]'}>
        <PainelBotAtendimento
          bot={bot}
          online={online}
          alternarStatus={alternarStatus}
          iaForm={iaForm}
          setIaForm={setIaForm}
          alternarAcaoBot={alternarAcaoBot}
          acoesDisponiveis={ACOES_BOT_DISPONIVEIS}
          tamMaxPrompt={TAM_MAX_PROMPT_IA}
          salvarIA={salvarIA}
          salvandoIA={salvandoIA}
          consumoIA={consumoIA}
          faqs={faqs}
          tempoRelativo={tempoRelativo}
        />
        {!bot.iaAtiva && (
          <PainelPerguntasBot
            faqs={faqs}
            novaFaq={novaFaq}
            setNovaFaq={setNovaFaq}
            adicionarFaq={adicionarFaq}
            alternarFaqAtivo={alternarFaqAtivo}
            editandoChaves={editandoChaves}
            setEditandoChaves={setEditandoChaves}
            salvarChaves={salvarChaves}
            excluirFaq={excluirFaq}
          />
        )}
      </div>
    </Pagina>
  );
}

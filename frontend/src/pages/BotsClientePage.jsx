import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Bot as BotIcon, Plus, WifiOff, ShieldAlert, QrCode, Link2,
} from 'lucide-react';
import {
  Button, Badge, EmptyState, useToast, Pagina, ColunasPagina, Painel,
} from '../components/ui';
import Modal from '../components/Modal';
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

// Tela do tenant pro bot WhatsApp: quando o bot NAO tem IA (padrao pos-pivo),
// o conteudo principal e o menu de FAQ. Quando o administrador libera o
// atendimento com IA pro bot (em admin/bots), esta tela troca o FAQ pelo
// prompt/ações da IA — as duas coisas nao coexistem em runtime (ver
// webhooksWhatsapp.routes.js: com iaAtiva, o FAQ nem e consultado). Layout:
// dois cartoes comparando a conexao oficial e a por QR Code, o passo a passo
// do oficial (campos tecnicos: phoneNumberId, credencial, verify token,
// callback URL) e, na coluna da direita, o bot de atendimento. O QR Code do
// WhatsApp Web abre num modal (com socket so enquanto ele esta aberto).
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
  const [qrAberto, setQrAberto] = useState(false);
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

  // Socket.io so enquanto o modal do QR Code esta aberto — o QR/status do
  // pareamento Baileys chega em tempo real pela sala do proprio bot (ver
  // backend/src/index.js: relay Redis -> socket.io -> sala bot:<id>).
  useEffect(() => {
    if (!qrAberto || !bot?.id) return;

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
  }, [qrAberto, bot?.id]);

  const conectarBaileys = async () => {
    if (!bot) return;
    setConectandoBaileys(true);
    try {
      await api.post(`/bots/${bot.id}/canal/baileys/conectar`);
      toast.success('Pareamento iniciado — aguarde o QR Code aparecer.');
    } catch (e) {
      toast.error(e.response?.data?.erro || 'Falha ao iniciar a conexão.');
    } finally {
      setConectandoBaileys(false);
    }
  };

  const desconectarBaileys = async () => {
    if (!bot || !window.confirm('Desconectar o WhatsApp Web? Vai precisar escanear o QR de novo pra reconectar.')) return;
    setDesconectandoBaileys(true);
    try {
      await api.post(`/bots/${bot.id}/canal/baileys/desconectar`);
      toast.success('Desconectado.');
      // Fora do modal nao ha socket: rele o status pra atualizar o cartao.
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

  const irParaPassoOficial = () => {
    document.getElementById(ID_PASSO_OFICIAL)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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

  // Botao principal no topo (Topbar): sem bot, cria; com bot, leva ao passo a
  // passo da conexao oficial (a recomendada).
  useAcaoTopo(
    bot
      ? <Button size="sm" icon={Link2} onClick={irParaPassoOficial}>Conectar número</Button>
      : (carregando ? null : <Button size="sm" icon={Plus} onClick={criarBot}>Criar bot</Button>),
    [bot?.id, carregando],
  );

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
            description="Crie o bot do seu WhatsApp para começar a configurar a conexão e o atendimento."
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

  let situacaoQr = { texto: 'Não está em uso', tom: 'neutro', detalhe: 'o bot usa a API oficial' };
  if (!baileysLiberado) {
    situacaoQr = { texto: 'Não liberado', tom: 'neutro', detalhe: 'fale com o administrador para liberar' };
  } else if (!ehOficial) {
    situacaoQr = {
      texto: STATUS_BAILEYS_LABEL[stBaileys] || 'Desconectado',
      tom: TOM_POR_VARIANT[STATUS_BAILEYS_VARIANT[stBaileys]] || 'neutro',
      detalhe: statusBaileys.baileysNumeroConectado ? `+${statusBaileys.baileysNumeroConectado}` : undefined,
    };
  }

  return (
    <Pagina>
      <ColunasPagina
        lateral={(
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
        )}
      >
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <CartaoConexao
            id="conexao-oficial"
            titulo="WhatsApp oficial (Meta)"
            destaque={ehOficial}
            etiqueta={<Badge variant="success" size="sm">Recomendado</Badge>}
            situacao={!ehOficial ? 'Não está em uso' : oficialConfigurado ? 'Configurado' : 'Falta configurar'}
            tomSituacao={!ehOficial ? 'neutro' : oficialConfigurado ? 'sucesso' : 'alerta'}
            detalheSituacao={!ehOficial
              ? 'o bot usa o número por QR Code'
              : bot.identificadorCanal ? `Phone Number ID ${bot.identificadorCanal}` : 'siga o passo a passo abaixo'}
            itens={[
              { texto: 'Conexão aprovada pela Meta, sem risco de bloqueio do número', tipo: 'ok' },
              { texto: 'Campanhas e avisos com modelos de mensagem aprovados', tipo: 'ok' },
              { texto: 'Funciona com o celular desligado', tipo: 'ok' },
            ]}
            rodape="Cobrado por mensagem pela Meta. Precisa do Gerenciador de Negócios da Meta."
            acoes={(
              <Button variant="secondary" size="sm" onClick={irParaPassoOficial}>
                {oficialConfigurado ? 'Dados técnicos' : 'Configurar'}
              </Button>
            )}
          />

          <CartaoConexao
            id="conexao-qr"
            titulo="Número do negócio por QR Code"
            destaque={!ehOficial}
            etiqueta={<Badge variant="neutral" size="sm">Não oficial</Badge>}
            situacao={situacaoQr.texto}
            tomSituacao={situacaoQr.tom}
            detalheSituacao={situacaoQr.detalhe}
            itens={[
              { texto: 'Conecta em 1 minuto, igual WhatsApp Web', tipo: 'ok' },
              { texto: 'Clientes falam com o número que já conhecem', tipo: 'ok' },
              { texto: 'Não passa pela Meta: use com moderação', tipo: 'aviso' },
              { texto: 'Risco real de banimento do número em disparo de mensagens em massa', tipo: 'nao' },
            ]}
            acoes={baileysLiberado ? (
              baileysConectado ? (
                <>
                  <Button variant="secondary" size="sm" icon={QrCode} onClick={() => setQrAberto(true)}>Ver conexão</Button>
                  <Button variant="danger-soft" size="sm" icon={WifiOff} onClick={desconectarBaileys} loading={desconectandoBaileys}>
                    Desconectar
                  </Button>
                </>
              ) : (
                <Button variant="secondary" size="sm" icon={QrCode} onClick={() => setQrAberto(true)}>
                  {!ehOficial && statusBaileys.qrCodeAtual ? 'Ver QR de novo' : 'Conectar por QR Code'}
                </Button>
              )
            ) : null}
          />
        </div>

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
      </ColunasPagina>

      <Modal
        isOpen={qrAberto}
        onClose={() => setQrAberto(false)}
        title="Número do negócio por QR Code"
        description="Conecte o WhatsApp do seu celular ao bot, como no WhatsApp Web."
        size="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--warning-soft)] border border-[var(--warning-soft)]">
            <ShieldAlert size={16} className="text-[var(--warning)] flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-[var(--warning-text)] leading-relaxed">
              Conexão não oficial (WhatsApp Web via QR Code) — não passa pela Meta, sem aprovação, mas com risco real de banimento do número, principalmente em disparo de mensagens em massa. Use com moderação.
            </p>
          </div>

          {stBaileys && (
            <Badge variant={STATUS_BAILEYS_VARIANT[stBaileys] || 'neutral'} size="sm">
              {STATUS_BAILEYS_LABEL[stBaileys] || stBaileys}
              {statusBaileys.baileysNumeroConectado ? ` — +${statusBaileys.baileysNumeroConectado}` : ''}
            </Badge>
          )}

          {stBaileys === 'CONECTADO' ? (
            <Button variant="danger-soft" icon={WifiOff} onClick={desconectarBaileys} loading={desconectandoBaileys}>
              Desconectar
            </Button>
          ) : statusBaileys.qrCodeAtual ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <img src={statusBaileys.qrCodeAtual} alt="QR Code do WhatsApp Web" className="w-56 h-56 border border-[var(--border-main)] rounded-lg" />
              <p className="text-xs text-[var(--text-muted)]">Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho.</p>
            </div>
          ) : (
            <Button variant="primary" icon={QrCode} onClick={conectarBaileys} loading={conectandoBaileys}>
              Conectar via QR Code
            </Button>
          )}
        </div>
      </Modal>
    </Pagina>
  );
}

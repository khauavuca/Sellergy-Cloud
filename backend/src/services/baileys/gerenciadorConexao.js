// Gerenciador de conexao Baileys (WhatsApp Web nao oficial) — vive DENTRO do
// processo worker.js, o unico que segura estado de longa duracao sem
// hot-reload (ver plano de implementacao). Registro em memoria (Map<botId,
// {sock}>) — 1 processo worker hoje, sem clustering.
//
// NAO VERIFICADO nesta sessao contra a versao exata do pacote instalado —
// makeWASocket/DisconnectReason/Browsers/os eventos connection.update,
// creds.update, messages.upsert sao API publica estavel do
// @whiskeysockets/baileys ha varias versoes, mas confirme depois de rodar
// `npm install`.
//
// Fluxo:
//   iniciarPareamento(botId)  -> abre socket, gera QR se preciso
//   obterSocket(botId)        -> usado pelo BaileysAdapter (envio) e pelo
//                                 disparo de campanha (services/campanhaService.js)
//   desconectar(botId, {logout}) -> fecha e opcionalmente limpa a sessao
//   reconectarBotsPareados()  -> chamado 1x no boot do worker.js

const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');

const prisma = require('../../prisma');
const { criarAuthState, limparAuthState } = require('./authStateStore');
const { calcularAtrasoReconexao, deveDesistir, atrasoNoBoot } = require('./reconexao');
const { processarMensagemRecebida } = require('../whatsappInbound');
const { criarProvedorWhatsapp } = require('../../adapters/whatsapp');

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' });

// Map<botId, {sock}> — o socket em si guarda tudo que o Baileys precisa
// internamente; so mantemos a referencia pra outros modulos (adapter,
// campanha) conseguirem mandar mensagem.
const conexoes = new Map();

// Estado da reconexao automatica (ver reconexao.js): quantas vezes seguidas
// caiu sem voltar, e o timer da proxima tentativa (pra `desconectar` cancelar
// uma reconexao ja agendada — antes, o timer religava o bot mesmo depois do
// usuario mandar desconectar).
const tentativasReconexao = new Map(); // botId -> n
const reconexoesAgendadas = new Map(); // botId -> timeout

function obterSocket(botId) {
  return conexoes.get(botId)?.sock || null;
}

// Campos do bot que o atendimento usa. Uma lista so, pra iniciarPareamento e
// obterBotAtualizado nao divergirem (o webhook da Meta seleciona o mesmo
// conjunto em routes/webhooksWhatsapp.routes.js).
const CAMPOS_BOT = {
  id: true, clienteId: true, credencialCanalId: true, provedorCanal: true,
  iaAtiva: true, iaModelo: true, iaPromptSistema: true,
  iaTokensIncluidosMes: true, iaPrecoPorMilTokensExcedenteCentavos: true,
  acoesPermitidas: true,
};

// A conexao dura dias, mas a configuracao do bot nao: o tenant liga/desliga
// a IA, troca o prompt, muda as ferramentas. O objeto carregado no pareamento
// so serve pra identidade (id/clienteId/credencial); o que o atendimento le e
// relido aqui, com cache curto pra nao ser 1 query por mensagem.
const cacheBots = new Map(); // botId -> { bot, expiraEm }
const CACHE_BOT_MS = 30_000;

async function obterBotAtualizado(botPareado) {
  const emCache = cacheBots.get(botPareado.id);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.bot;
  const bot = await prisma.bot.findUnique({ where: { id: botPareado.id }, select: CAMPOS_BOT })
    .catch((e) => { console.error(`[baileys] falha ao reler bot ${botPareado.id}:`, e?.message); return null; });
  const efetivo = bot || botPareado;
  cacheBots.set(botPareado.id, { bot: efetivo, expiraEm: Date.now() + CACHE_BOT_MS });
  return efetivo;
}

async function publicarEvento(botId, tipo, dados) {
  // Redis pub/sub e o unico jeito do worker (sem req.io) avisar o backend em
  // tempo real — o backend relay em index.js repassa pro socket.io da sala
  // do bot. Best-effort: se o Redis cair, o front ainda pode consultar
  // GET /bots/:id/canal/baileys/status como fallback.
  try {
    const IORedis = require('ioredis');
    if (!publicarEvento._pub) {
      publicarEvento._pub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
    }
    await publicarEvento._pub.publish('baileys:eventos', JSON.stringify({ botId, tipo, dados }));
  } catch (e) {
    console.error('[baileys/publicarEvento] falha ao publicar', e?.message);
  }
}

async function atualizarStatus(botId, dados) {
  const bot = await prisma.bot.update({
    where: { id: botId },
    data: { ...dados, baileysAtualizadoEm: new Date() },
    select: { clienteId: true, statusConexaoBaileys: true, qrCodeAtual: true, baileysNumeroConectado: true },
  });
  await publicarEvento(botId, 'baileys_status', bot);
  return bot;
}

async function tratarMensagemRecebida(botPareado, upsert) {
  if (upsert.type !== 'notify') return;
  const sock = obterSocket(botPareado.id);
  if (!sock) {
    console.error(`[baileys/mensagem] bot ${botPareado.id}: evento chegou mas nao ha socket vivo registrado.`);
    return;
  }
  console.log(`[baileys/mensagem] bot ${botPareado.id}: ${upsert.messages?.length || 0} mensagem(ns) recebida(s).`);

  const bot = await obterBotAtualizado(botPareado);
  const faqs = bot.iaAtiva ? [] : await prisma.faq.findMany({
    where: { clienteId: bot.clienteId, ativo: true },
    orderBy: { ordem: 'asc' },
  });
  const adapter = criarProvedorWhatsapp('BAILEYS', { modo: 'live', socket: sock });

  for (const msg of upsert.messages || []) {
    // Ignora mensagem enviada pelo proprio bot (eco) e mensagem de grupo — o
    // modelo de Lead do sistema e 1:1 por cliente final, nao por grupo.
    if (msg.key?.fromMe) continue;
    const remoteJid = msg.key?.remoteJid || '';
    if (remoteJid.endsWith('@g.us')) continue;

    // So tira o sufixo padrao (@s.whatsapp.net -> vira so o numero, formato
    // que reabrirLeadPorTelefone e o resto do sistema esperam). Se vier de um
    // JID @lid (identidade nova do WhatsApp, nao e o numero de telefone), o
    // replace nao acha nada pra tirar e `de` fica com o @lid junto de
    // proposito — e assim que paraJid() em adapters/whatsapp/baileys.js sabe
    // que precisa responder pro JID exato, nao reconstruir um errado.
    const de = remoteJid.replace('@s.whatsapp.net', '');
    const texto = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.buttonsResponseMessage?.selectedDisplayText
      || msg.message?.listResponseMessage?.title
      || '';
    if (!texto) {
      console.log(`[baileys/mensagem] bot ${bot.id}: mensagem de ${de} sem texto reconhecido (ignorada) — tipo: ${Object.keys(msg.message || {}).join(',') || 'desconhecido'}.`);
      continue;
    }
    console.log(`[baileys/mensagem] bot ${bot.id}: "${texto}" de ${de} — montando resposta...`);

    await processarMensagemRecebida({
      bot, texto, de, faqs, adapter,
      canalContexto: { phoneNumberId: null, token: null, telefoneCliente: de },
    })
      .then((resposta) => console.log(`[baileys/mensagem] bot ${bot.id}: resposta ${resposta?.texto ? 'enviada' : 'vazia (nada a responder)'}.`))
      .catch((e) => console.error(`[baileys/mensagem] falha ao processar (bot ${bot.id}):`, e?.message));
  }

  const recebidas = upsert.messages?.length || 0;
  prisma.bot.update({
    where: { id: bot.id },
    data: {
      totalMensagens: { increment: recebidas },
      mensagensHoje: { increment: recebidas }, // zerado as 00:01 (jobs/cronCaixaDiario.js)
      ultimaAtividadeEm: new Date(),
    },
  }).catch((e) => console.error('[baileys/stats]', e?.message));
}

async function iniciarPareamento(botId) {
  if (conexoes.has(botId)) return; // ja conectado/conectando — no-op

  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: CAMPOS_BOT });
  if (!bot || bot.provedorCanal !== 'BAILEYS' || !bot.credencialCanalId) {
    console.error(`[baileys] iniciarPareamento: bot ${botId} invalido ou sem credencial associada.`);
    return;
  }

  console.log(`[baileys] iniciando pareamento pro bot ${botId}...`);
  await atualizarStatus(botId, { statusConexaoBaileys: 'CONECTANDO' });

  const { state, saveCreds } = await criarAuthState({
    credencialId: bot.credencialCanalId, clienteId: bot.clienteId, botId, logger,
  });

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu('Sellergy Cloud'),
    printQRInTerminal: false,
  });
  conexoes.set(botId, { sock });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', (upsert) => {
    tratarMensagemRecebida(bot, upsert).catch((e) => console.error(`[baileys] erro no messages.upsert (bot ${botId}):`, e?.message));
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`[baileys] QR gerado pro bot ${botId} — aguardando leitura.`);
      const qrPng = await QRCode.toDataURL(qr).catch((e) => {
        console.error(`[baileys] falha ao gerar PNG do QR (bot ${botId}):`, e?.message);
        return null;
      });
      await atualizarStatus(botId, { statusConexaoBaileys: 'AGUARDANDO_QR', qrCodeAtual: qrPng });
      return;
    }

    if (connection === 'open') {
      tentativasReconexao.delete(botId); // voltou: zera o backoff
      const numero = sock.user?.id?.split(':')[0] || null;
      console.log(`[baileys] bot ${botId} conectado como +${numero}.`);
      await atualizarStatus(botId, { statusConexaoBaileys: 'CONECTADO', qrCodeAtual: null, baileysNumeroConectado: numero, identificadorCanal: numero });
      return;
    }

    if (connection === 'close') {
      conexoes.delete(botId);
      const codigoDesconexao = lastDisconnect?.error?.output?.statusCode;
      const foiLogout = codigoDesconexao === DisconnectReason.loggedOut;
      console.log(`[baileys] conexao do bot ${botId} fechada (codigo ${codigoDesconexao || 'desconhecido'}, logout=${foiLogout}).`);

      if (foiLogout) {
        // Dispositivo desvinculado no celular — limpa a sessao, exige novo QR.
        await limparAuthState({ credencialId: bot.credencialCanalId, clienteId: bot.clienteId }).catch(() => {});
        await atualizarStatus(botId, { statusConexaoBaileys: 'LOGOUT', qrCodeAtual: null, baileysNumeroConectado: null });
        return;
      }

      // Desconexao transitoria (rede, restart) — tenta de novo com a mesma
      // sessao, sem exigir acao do usuario. Backoff exponencial com teto e
      // jitter (reconexao.js); depois de MAX_TENTATIVAS seguidas desiste e
      // marca DESCONECTADO — ai so o "Conectar" manual religa.
      const tentativa = (tentativasReconexao.get(botId) || 0) + 1;
      if (deveDesistir(tentativa)) {
        tentativasReconexao.delete(botId);
        console.error(`[baileys] bot ${botId}: ${tentativa - 1} reconexoes seguidas falharam — desistindo ate acao manual.`);
        await atualizarStatus(botId, { statusConexaoBaileys: 'DESCONECTADO', qrCodeAtual: null });
        return;
      }
      tentativasReconexao.set(botId, tentativa);
      const atraso = calcularAtrasoReconexao(tentativa);
      console.log(`[baileys] bot ${botId}: reconexao ${tentativa} em ${Math.round(atraso / 1000)}s.`);
      await atualizarStatus(botId, { statusConexaoBaileys: 'CONECTANDO' });
      reconexoesAgendadas.set(botId, setTimeout(() => {
        reconexoesAgendadas.delete(botId);
        iniciarPareamento(botId).catch((e) => console.error(`[baileys] falha ao reconectar bot ${botId}:`, e?.message));
      }, atraso));
    }
  });
}

async function desconectar(botId) {
  // Cancela reconexao pendente e limpa o estado — desconectar e definitivo
  // ate o usuario mandar conectar de novo.
  clearTimeout(reconexoesAgendadas.get(botId));
  reconexoesAgendadas.delete(botId);
  tentativasReconexao.delete(botId);
  cacheBots.delete(botId);

  const conexao = conexoes.get(botId);
  if (conexao?.sock) {
    await conexao.sock.logout().catch(() => {});
    conexoes.delete(botId);
  }
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { clienteId: true, credencialCanalId: true } });
  if (bot?.credencialCanalId) {
    await limparAuthState({ credencialId: bot.credencialCanalId, clienteId: bot.clienteId }).catch(() => {});
  }
  await atualizarStatus(botId, { statusConexaoBaileys: 'DESCONECTADO', qrCodeAtual: null, baileysNumeroConectado: null });
}

/**
 * Chamado 1x no boot do worker.js — reconecta sozinho os bots ja pareados.
 * Em lotes pequenos com folga entre eles (reconexao.js), nao todos de uma vez:
 * N handshakes simultaneos do mesmo IP a cada deploy e pico de CPU/RAM e
 * sinal de automacao pro WhatsApp.
 */
async function reconectarBotsPareados() {
  const bots = await prisma.bot.findMany({
    where: { provedorCanal: 'BAILEYS', statusConexaoBaileys: 'CONECTADO' },
    select: { id: true },
    orderBy: { baileysAtualizadoEm: 'asc' },
  });
  bots.forEach((bot, indice) => {
    setTimeout(() => {
      iniciarPareamento(bot.id).catch((e) => console.error(`[baileys] falha ao reconectar bot ${bot.id} no boot:`, e?.message));
    }, atrasoNoBoot(indice));
  });
  if (bots.length > 0) {
    const ultimo = atrasoNoBoot(bots.length - 1) / 1000;
    console.log(`[baileys] reconectando ${bots.length} bot(s) pareado(s) do boot em lotes (ultimo em ~${ultimo}s).`);
  }
}

module.exports = { iniciarPareamento, desconectar, reconectarBotsPareados, obterSocket };

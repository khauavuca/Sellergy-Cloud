// Gerenciador de conexao Baileys (WhatsApp Web nao oficial) — vive DENTRO do
// processo worker.js, o unico que segura estado de longa duracao. Registro em
// memoria (Map<botId, {sock}>): 1 processo worker, sem clustering.
//
// Ajustes pra VPS de 1 GB e pra nao parecer robo:
//   - sem historico de conversa, sem "online" automatico, sem metadados de
//     grupo, ignora status/canais/grupos: cada sessao fica em poucos MB;
//   - reconexao com espera crescente (3 s, 6 s, 12 s... ate 2 min) e parada
//     nos erros que nao se resolvem sozinhos (sessao invalida, numero banido);
//   - marca como lida a mensagem que o bot respondeu (como uma pessoa faria);
//   - SAIR/PARAR vira opt-out (nunca mais recebe campanha nem automatico);
//   - le o voto da enquete do lembrete (Confirmar / Remarcar);
//   - QR nunca escaneado: para de gerar QR depois de BAILEYS_QR_EXPIRA_MS
//     (padrao 5 min) e marca DESCONECTADO, em vez de reconectar pra sempre;
//   - trava por bot no iniciarPareamento: nunca dois sockets pro mesmo bot.
//
// Fluxo:
//   iniciarPareamento(botId)  -> abre socket, gera QR se preciso
//   obterSocket(botId)        -> usado pelo BaileysAdapter (envio)
//   desconectar(botId)        -> fecha e limpa a sessao
//   reconectarBotsPareados()  -> chamado 1x no boot do worker.js

const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  DisconnectReason,
  Browsers,
  BufferJSON,
  getAggregateVotesInPollMessage,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
} = require('@whiskeysockets/baileys');

const prisma = require('../../prisma');
const { criarAuthState, limparAuthState } = require('./authStateStore');
const { processarMensagemRecebida, CAMPOS_BOT_ATENDIMENTO } = require('../whatsappInbound');
const { criarProvedorWhatsapp } = require('../../adapters/whatsapp');
const envioHumano = require('./envioHumano');
const conversas = require('../../conversas/servico');
const { statusDoEnvio } = require('../../conversas/regras');

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' });

const conexoes = new Map();
const tentativas = new Map();
const iniciando = new Set(); // trava: iniciarPareamento em andamento por bot
const qrDesde = new Map(); // botId -> quando apareceu o 1o QR (bot ainda nao pareado)
const ESPERA_MAX_MS = 2 * 60 * 1000;

function qrExpiraMs() {
  const n = Number(process.env.BAILEYS_QR_EXPIRA_MS);
  return Number.isInteger(n) && n > 0 ? n : 5 * 60 * 1000;
}

/** Regra pura: o QR esta na tela ha tempo demais sem ninguem escanear? */
function qrAbandonado({ desde, agora = Date.now(), limiteMs = qrExpiraMs() }) {
  return Boolean(desde) && agora - desde >= limiteMs;
}

// Desconexoes que pedem acao humana (novo QR) — reconectar so piora.
const PRECISA_NOVO_QR = new Set([DisconnectReason.loggedOut, DisconnectReason.badSession, DisconnectReason.multideviceMismatch]);
// Numero bloqueado/banido ou sessao aberta em outro lugar: para e avisa.
const PARAR_SEM_LIMPAR = new Set([DisconnectReason.forbidden, DisconnectReason.connectionReplaced]);

function obterSocket(botId) {
  return conexoes.get(botId)?.sock || null;
}

async function publicarEvento(botId, tipo, dados) {
  // Redis pub/sub: unico jeito do worker avisar o backend em tempo real
  // (index.js repassa pro socket.io da sala do bot).
  try {
    const IORedis = require('ioredis');
    if (!publicarEvento._pub) publicarEvento._pub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
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

// ---------- enquetes (voto do lembrete) ----------

/** Guarda a enquete enviada pra conseguir decifrar o voto que volta. */
async function registrarEnquete({ botId, mensagem, tipo, referenciaId }) {
  if (!mensagem?.key?.id || !mensagem.message) return;
  await prisma.enqueteWhatsapp.create({
    data: {
      id: mensagem.key.id,
      botId,
      remoteJid: mensagem.key.remoteJid,
      mensagem: JSON.parse(JSON.stringify(mensagem.message, BufferJSON.replacer)),
      tipo,
      referenciaId,
    },
  }).catch((e) => console.error('[baileys/enquete] registrar', e?.message));
}

async function carregarMensagemEnquete(id) {
  const linha = await prisma.enqueteWhatsapp.findUnique({ where: { id } }).catch(() => null);
  if (!linha) return null;
  return { linha, message: JSON.parse(JSON.stringify(linha.mensagem), BufferJSON.reviver) };
}

async function tratarVotoEnquete(bot, key, pollUpdates) {
  const salvo = await carregarMensagemEnquete(key.id);
  if (!salvo || salvo.linha.respondidaEm) return;
  const votos = getAggregateVotesInPollMessage({ message: salvo.message, pollUpdates });
  const escolhida = votos.find((v) => v.voters?.length > 0)?.name;
  if (!escolhida) return;

  if (salvo.linha.tipo === 'CONFIRMACAO_AGENDAMENTO') {
    const acao = /remarc/i.test(escolhida) ? 'REMARCAR' : 'CONFIRMAR';
    const { aplicarResposta } = require('../../agenda/respostaLembrete');
    const agendamento = await prisma.agendamento.findUnique({ where: { id: salvo.linha.referenciaId } });
    const r = await aplicarResposta({ agendamento, acao, origem: 'CLIENTE_WHATSAPP' });
    await prisma.enqueteWhatsapp.update({ where: { id: key.id }, data: { respondidaEm: new Date() } }).catch(() => {});
    const sock = obterSocket(bot.id);
    if (sock && r.mensagem) {
      const adapter = criarProvedorWhatsapp('BAILEYS', { modo: 'live', socket: sock });
      await adapter.enviarTexto({ para: salvo.linha.remoteJid.split('@')[0], texto: r.mensagem });
    }
  }

  // Oferta da fila de encaixe: "Quero" / "Não posso" (referenciaId = envio).
  if (salvo.linha.tipo === 'OFERTA_ENCAIXE') {
    const acao = /quero/i.test(escolhida) ? 'ACEITAR' : 'RECUSAR';
    const { responderEnvio } = require('../../agenda/encaixe');
    const r = await responderEnvio({ envioId: salvo.linha.referenciaId, acao }).catch((e) => ({ mensagem: e.status ? e.message : null }));
    await prisma.enqueteWhatsapp.update({ where: { id: key.id }, data: { respondidaEm: new Date() } }).catch(() => {});
    const sock = obterSocket(bot.id);
    if (sock && r?.mensagem) {
      const adapter = criarProvedorWhatsapp('BAILEYS', { modo: 'live', socket: sock });
      await adapter.enviarTexto({ para: salvo.linha.remoteJid.split('@')[0], texto: r.mensagem });
    }
  }
}

// ---------- mensagens recebidas ----------

function textoDaMensagem(msg) {
  const m = msg.message || {};
  return m.conversation
    || m.extendedTextMessage?.text
    || m.buttonsResponseMessage?.selectedDisplayText
    || m.listResponseMessage?.title
    || m.imageMessage?.caption
    || '';
}

async function registrarOptOut(clienteId, telefone) {
  await prisma.optOutWhatsapp.upsert({
    where: { clienteId_telefone: { clienteId, telefone } },
    create: { clienteId, telefone },
    update: {},
  });
}

async function tratarMensagemRecebida(botInicial, upsert) {
  if (upsert.type !== 'notify') return;
  const sock = obterSocket(botInicial.id);
  if (!sock) return;
  // Recarrega a cada lote: o socket vive horas e o dono pode ter desligado o
  // bot (status OFFLINE) ou mudado a IA nesse meio tempo.
  const bot = await prisma.bot.findUnique({ where: { id: botInicial.id }, select: { ...CAMPOS_BOT_ATENDIMENTO } })
    .catch(() => null) || botInicial;

  let faqs = null;
  const adapter = criarProvedorWhatsapp('BAILEYS', { modo: 'live', socket: sock });

  for (const msg of upsert.messages || []) {
    if (msg.key?.fromMe) continue;
    const remoteJid = msg.key?.remoteJid || '';
    if (!remoteJid.endsWith('@s.whatsapp.net')) continue; // grupo, status, canal: fora do modelo 1:1

    const de = remoteJid.split('@')[0];
    const texto = textoDaMensagem(msg);
    if (!texto) continue;

    if (envioHumano.ehPedidoDeSaida(texto)) {
      await registrarOptOut(bot.clienteId, de).catch((e) => console.error('[baileys/optout]', e?.message));
      await sock.readMessages([msg.key]).catch(() => {});
      const textoSaida = 'Pronto, você não vai mais receber nossas mensagens automáticas. Se precisar de algo, é só escrever aqui.';
      const envio = await adapter.enviarTexto({ para: de, texto: textoSaida });
      // Caixa de entrada: o pedido e a resposta ficam na conversa.
      const base = { clienteId: bot.clienteId, telefone: de, botId: bot.id, canal: 'BAILEYS' };
      await conversas.registrarSeguro({ ...base, texto, direcao: 'ENTRADA', origem: 'CONTATO', nomeContato: msg.pushName || null });
      await conversas.registrarSeguro({ ...base, texto: textoSaida, direcao: 'SAIDA', origem: 'BOT', status: statusDoEnvio(envio), erro: envio?.ok ? null : envio?.erro });
      continue;
    }

    if (faqs === null) {
      faqs = bot.iaAtiva ? [] : await prisma.faq.findMany({ where: { clienteId: bot.clienteId, ativo: true }, orderBy: { ordem: 'asc' } });
    }
    await sock.readMessages([msg.key]).catch(() => {});
    await processarMensagemRecebida({
      bot, texto, de, faqs, adapter, nomeContato: msg.pushName || null,
      canalContexto: { phoneNumberId: null, token: null, telefoneCliente: de },
    }).catch((e) => console.error(`[baileys/mensagem] falha ao processar (bot ${bot.id}):`, e?.message));
  }

  prisma.bot.update({
    where: { id: bot.id },
    data: { totalMensagens: { increment: upsert.messages?.length || 0 }, ultimaAtividadeEm: new Date() },
  }).catch((e) => console.error('[baileys/stats]', e?.message));
}

// ---------- conexao ----------

function agendarReconexao(botId) {
  const n = (tentativas.get(botId) || 0) + 1;
  tentativas.set(botId, n);
  const espera = Math.min(ESPERA_MAX_MS, 3000 * 2 ** (n - 1)) + Math.floor(Math.random() * 1000);
  setTimeout(() => iniciarPareamento(botId).catch((e) => console.error(`[baileys] falha ao reconectar bot ${botId}:`, e?.message)), espera);
}

async function iniciarPareamento(botId) {
  // Trava: dois comandos "conectar" seguidos (clique duplo, reconexao + boot)
  // abririam dois sockets pro mesmo numero e um derrubaria o outro.
  if (conexoes.has(botId) || iniciando.has(botId)) return;
  iniciando.add(botId);
  try {
    await abrirConexao(botId);
  } finally {
    iniciando.delete(botId);
  }
}

/** Grava o numero conectado como identificadorCanal (unico entre os bots). */
async function gravarNumeroConectado(bot, numero) {
  const dados = { statusConexaoBaileys: 'CONECTADO', qrCodeAtual: null, baileysNumeroConectado: numero, identificadorCanal: numero };
  try {
    await atualizarStatus(bot.id, dados);
    return true;
  } catch (e) {
    if (e?.code !== 'P2002' || !numero) throw e;
  }
  // Numero ja esta em outro bot. Do mesmo cliente (bot antigo): libera la e
  // grava aqui. De outro cliente: recusa e desconecta.
  const outro = await prisma.bot.findFirst({ where: { identificadorCanal: numero, id: { not: bot.id } }, select: { id: true, clienteId: true } });
  if (outro && outro.clienteId === bot.clienteId) {
    await prisma.bot.update({ where: { id: outro.id }, data: { identificadorCanal: null } });
    await atualizarStatus(bot.id, dados);
    return true;
  }
  return false;
}

async function abrirConexao(botId) {
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { ...CAMPOS_BOT_ATENDIMENTO } });
  if (!bot || bot.provedorCanal !== 'BAILEYS' || !bot.credencialCanalId) {
    console.error(`[baileys] iniciarPareamento: bot ${botId} invalido ou sem credencial associada.`);
    return;
  }

  await atualizarStatus(botId, { statusConexaoBaileys: 'CONECTANDO' });

  const { state, saveCreds } = await criarAuthState({
    credencialId: bot.credencialCanalId, clienteId: bot.clienteId, botId, logger,
  });

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu('Sellergy Cloud'),
    printQRInTerminal: false,
    // Leve: nada de historico, presenca automatica ou preview pesado.
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidGroup(jid) || isJidNewsletter(jid),
    // O Baileys pede a mensagem original pra decifrar voto de enquete.
    getMessage: async (key) => (await carregarMensagemEnquete(key.id))?.message || undefined,
  });
  conexoes.set(botId, { sock });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', (upsert) => {
    tratarMensagemRecebida(bot, upsert).catch((e) => console.error(`[baileys] erro no messages.upsert (bot ${botId}):`, e?.message));
  });

  sock.ev.on('messages.update', (atualizacoes) => {
    for (const { key, update } of atualizacoes || []) {
      if (update?.pollUpdates && key?.fromMe) {
        tratarVotoEnquete(bot, key, update.pollUpdates).catch((e) => console.error('[baileys/enquete] voto', e?.message));
      }
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (!qrDesde.has(botId)) qrDesde.set(botId, Date.now());
      if (qrAbandonado({ desde: qrDesde.get(botId) })) {
        // Ninguem escaneou: para de gerar QR (o 'close' abaixo nao reconecta).
        console.log(`[baileys] QR do bot ${botId} abandonado — parando o pareamento.`);
        sock.end(undefined);
        return;
      }
      const qrPng = await QRCode.toDataURL(qr).catch(() => null);
      await atualizarStatus(botId, { statusConexaoBaileys: 'AGUARDANDO_QR', qrCodeAtual: qrPng });
      return;
    }

    if (connection === 'open') {
      tentativas.delete(botId);
      qrDesde.delete(botId);
      const numero = sock.user?.id?.split(':')[0] || null;
      const gravou = await gravarNumeroConectado(bot, numero);
      if (!gravou) {
        console.warn(`[baileys] bot ${botId}: numero final ${String(numero || '').slice(-4)} ja conectado em outra conta — desconectando.`);
        await desconectar(botId);
        const { criarNotificacao } = require('../../utils/notificacoes');
        await criarNotificacao(prisma, {
          clienteId: bot.clienteId, tipo: 'GENERICA',
          titulo: 'Número já usado em outra conta',
          mensagem: 'Este número de WhatsApp já está conectado em outra conta da plataforma. Use outro número ou fale com o suporte.',
          link: '/app/bots',
        }).catch(() => {});
        return;
      }
      if (numero) await envioHumano.registrarConexao(numero);
      console.log(`[baileys] bot ${botId} conectado (final ${String(numero || '').slice(-4)}).`);
      return;
    }

    if (connection === 'close') {
      conexoes.delete(botId);
      const codigo = lastDisconnect?.error?.output?.statusCode;
      console.log(`[baileys] conexao do bot ${botId} fechada (codigo ${codigo || 'desconhecido'}).`);

      if (PRECISA_NOVO_QR.has(codigo)) {
        tentativas.delete(botId);
        await limparAuthState({ credencialId: bot.credencialCanalId, clienteId: bot.clienteId }).catch(() => {});
        await atualizarStatus(botId, { statusConexaoBaileys: 'LOGOUT', qrCodeAtual: null, baileysNumeroConectado: null });
        return;
      }
      if (PARAR_SEM_LIMPAR.has(codigo)) {
        tentativas.delete(botId);
        await atualizarStatus(botId, { statusConexaoBaileys: 'DESCONECTADO', qrCodeAtual: null });
        const { criarNotificacao } = require('../../utils/notificacoes');
        await criarNotificacao(prisma, {
          clienteId: bot.clienteId, tipo: 'GENERICA',
          titulo: 'WhatsApp desconectado',
          mensagem: codigo === DisconnectReason.forbidden
            ? 'O WhatsApp bloqueou este número para uso pelo WhatsApp Web. Conecte outro número ou use o WhatsApp oficial.'
            : 'O WhatsApp deste número foi aberto em outro computador. Conecte de novo em Configurações.',
          link: '/app/bots',
        }).catch(() => {});
        return;
      }

      // QR nunca escaneado ha tempo demais: nao reconecta (senao gera QR pra
      // sempre, gastando memoria/CPU da VPS com uma tela que ninguem olha).
      if (qrAbandonado({ desde: qrDesde.get(botId) })) {
        tentativas.delete(botId);
        qrDesde.delete(botId);
        await limparAuthState({ credencialId: bot.credencialCanalId, clienteId: bot.clienteId }).catch(() => {});
        await atualizarStatus(botId, { statusConexaoBaileys: 'DESCONECTADO', qrCodeAtual: null });
        return;
      }

      await atualizarStatus(botId, { statusConexaoBaileys: 'CONECTANDO' });
      agendarReconexao(botId);
    }
  });
}

async function desconectar(botId) {
  const conexao = conexoes.get(botId);
  tentativas.delete(botId);
  qrDesde.delete(botId);
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

/** Chamado 1x no boot do worker.js — reconecta os bots ja pareados, espacados. */
async function reconectarBotsPareados() {
  const bots = await prisma.bot.findMany({
    where: { provedorCanal: 'BAILEYS', statusConexaoBaileys: { in: ['CONECTADO', 'CONECTANDO'] } },
    select: { id: true },
  });
  bots.forEach((bot, i) => {
    // 2 s entre cada um: nao sobe todas as sessoes de uma vez (pico de memoria/CPU).
    setTimeout(() => iniciarPareamento(bot.id).catch((e) => console.error(`[baileys] falha ao reconectar bot ${bot.id} no boot:`, e?.message)), i * 2000);
  });
  if (bots.length > 0) console.log(`[baileys] reconectando ${bots.length} bot(s) pareado(s) do boot.`);
}

/** Limpeza diaria: enquetes com mais de 7 dias nao servem mais. */
async function limparEnquetesAntigas() {
  const r = await prisma.enqueteWhatsapp.deleteMany({ where: { criadoEm: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
  return r.count;
}

module.exports = { iniciarPareamento, desconectar, reconectarBotsPareados, obterSocket, registrarEnquete, limparEnquetesAntigas, textoDaMensagem, qrAbandonado };

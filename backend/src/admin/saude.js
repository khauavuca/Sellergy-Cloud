// =====================================================================
// SAUDE DO SISTEMA (painel admin)
// =====================================================================
// Tudo medido na hora, sem numero guardado:
//   - Postgres: SELECT 1 e a latencia;
//   - Redis: PING e a latencia;
//   - filas BullMQ (nomes de filas/index.js): contagem por estado e as
//     ultimas falhas;
//   - WhatsApp: numeros por canal/estado (QR Code: conectado, desconectado,
//     esperando QR);
//   - notas fiscais com erro nas ultimas 24 h;
//   - memoria/uptime do processo e da maquina, versao do app.
// =====================================================================

const os = require('os');
const prisma = require('../prisma');

const NOMES_FILAS = () => {
  const f = require('../filas');
  return [
    { nome: f.NOME_FILA_AVISO_PLATAFORMA, rotulo: 'Avisos do Sellergy no WhatsApp' },
    { nome: f.NOME_FILA_WHATSAPP_TENANT, rotulo: 'Mensagens dos negócios no WhatsApp' },
    { nome: f.NOME_FILA_CAMPANHA, rotulo: 'Campanhas (canal oficial)' },
    { nome: f.NOME_FILA_CAMPANHA_BAILEYS, rotulo: 'Campanhas (QR Code)' },
    { nome: f.NOME_FILA_BAILEYS_COMANDO, rotulo: 'Comandos do QR Code' },
  ];
};

let redis = null;
let filas = null;

function obterRedis() {
  if (!redis) {
    const { criarConexaoRedis } = require('../filas');
    redis = criarConexaoRedis();
    redis.on('error', () => {}); // o erro aparece no ping, sem inundar o log
  }
  return redis;
}

function obterFilas() {
  if (!filas) {
    const { Queue } = require('bullmq');
    const conexao = obterRedis();
    filas = NOMES_FILAS().map((f) => ({ ...f, fila: new Queue(f.nome, { connection: conexao }) }));
  }
  return filas;
}

async function comTempo(fn, limiteMs = 3000) {
  const inicio = process.hrtime.bigint();
  let timer;
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('sem resposta em 3 s')), limiteMs); }),
    ]);
    return { ok: true, latenciaMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e5) / 10 };
  } catch (e) {
    return { ok: false, erro: e?.message || 'falhou' };
  } finally {
    clearTimeout(timer);
  }
}

async function situacaoFilas() {
  const lista = obterFilas();
  return Promise.all(lista.map(async ({ nome, rotulo, fila }) => {
    try {
      const [contagem, falhas] = await Promise.all([
        fila.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'paused'),
        fila.getFailed(0, 4),
      ]);
      return {
        nome,
        rotulo,
        contagem,
        falhasRecentes: falhas.filter(Boolean).map((j) => ({
          id: j.id,
          nome: j.name,
          motivo: String(j.failedReason || 'sem motivo').slice(0, 300),
          tentativas: j.attemptsMade,
          em: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
        })),
      };
    } catch (e) {
      return { nome, rotulo, erro: e?.message || 'indisponível' };
    }
  }));
}

async function situacaoWhatsapp() {
  const bots = await prisma.bot.findMany({
    select: { provedorCanal: true, status: true, statusConexaoBaileys: true, identificadorCanal: true, baileysAtualizadoEm: true },
  });
  const qr = bots.filter((b) => b.provedorCanal === 'BAILEYS');
  const oficial = bots.filter((b) => b.provedorCanal === 'META_CLOUD' && b.identificadorCanal);
  const porEstado = {};
  qr.forEach((b) => { const k = b.statusConexaoBaileys || 'DESCONECTADO'; porEstado[k] = (porEstado[k] || 0) + 1; });
  return {
    qrCode: {
      total: qr.length,
      conectados: porEstado.CONECTADO || 0,
      aguardandoQr: porEstado.AGUARDANDO_QR || 0,
      conectando: porEstado.CONECTANDO || 0,
      desconectados: (porEstado.DESCONECTADO || 0) + (porEstado.LOGOUT || 0),
    },
    oficial: {
      total: oficial.length,
      comErro: oficial.filter((b) => b.status === 'ERROR').length,
    },
  };
}

async function notasRejeitadas24h() {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [total, ultimas] = await Promise.all([
    prisma.documentoFiscal.count({ where: { status: 'ERRO', atualizadoEm: { gte: desde } } }),
    prisma.documentoFiscal.findMany({
      where: { status: 'ERRO', atualizadoEm: { gte: desde } },
      orderBy: { atualizadoEm: 'desc' },
      take: 5,
      select: { id: true, tipo: true, mensagemErro: true, atualizadoEm: true, cliente: { select: { id: true, nome: true } } },
    }),
  ]);
  return {
    total,
    ultimas: ultimas.map((n) => ({
      id: n.id, tipo: n.tipo, cliente: n.cliente?.nome || null, clienteId: n.cliente?.id || null,
      motivo: String(n.mensagemErro || 'sem motivo').slice(0, 300), em: n.atualizadoEm,
    })),
  };
}

function versaoDoApp() {
  let pacote = null;
  try { pacote = require('../../package.json').version; } catch { /* sem package.json */ }
  return { app: process.env.APP_VERSAO || pacote || null, node: process.version };
}

function recursos() {
  const mem = process.memoryUsage();
  const total = os.totalmem();
  const livre = os.freemem();
  return {
    processo: {
      rssMb: Math.round(mem.rss / 1048576),
      heapUsadoMb: Math.round(mem.heapUsed / 1048576),
      uptimeSeg: Math.round(process.uptime()),
      pid: process.pid,
    },
    sistema: {
      memoriaTotalMb: Math.round(total / 1048576),
      memoriaLivreMb: Math.round(livre / 1048576),
      memoriaUsadaPct: Math.round(((total - livre) / total) * 1000) / 10,
      carga: os.loadavg().map((v) => Math.round(v * 100) / 100), // 0 no Windows
      nucleos: os.cpus().length,
      uptimeSeg: Math.round(os.uptime()),
      plataforma: `${os.platform()} ${os.release()}`,
    },
  };
}

async function situacaoGeral() {
  const [postgres, redisPing] = await Promise.all([
    comTempo(() => prisma.$queryRaw`SELECT 1`),
    comTempo(() => obterRedis().ping()),
  ]);
  const [filasInfo, whatsapp, notas, ia] = await Promise.all([
    redisPing.ok ? situacaoFilas() : Promise.resolve([]),
    postgres.ok ? situacaoWhatsapp() : Promise.resolve(null),
    postgres.ok ? notasRejeitadas24h() : Promise.resolve(null),
    // Teto global diario da IA (services/iaLimites.js).
    postgres.ok ? require('../services/iaLimites').situacaoTetoGlobal().catch(() => null) : Promise.resolve(null),
  ]);
  return {
    geradoEm: new Date().toISOString(),
    postgres,
    redis: redisPing,
    filas: filasInfo,
    whatsapp,
    notasRejeitadas: notas,
    ia,
    recursos: recursos(),
    versao: versaoDoApp(),
  };
}

/** Avisos curtos pra "Precisa de voce" na Visao geral. */
function alertasDaSaude(s) {
  const alertas = [];
  if (!s.postgres.ok) alertas.push('Banco de dados sem resposta');
  if (!s.redis.ok) alertas.push('Redis sem resposta (filas paradas)');
  const falhas = (s.filas || []).reduce((t, f) => t + (f.contagem?.failed || 0), 0);
  if (falhas) alertas.push(`${falhas} tarefa(s) com falha nas filas`);
  if (s.whatsapp?.qrCode?.desconectados) alertas.push(`${s.whatsapp.qrCode.desconectados} WhatsApp por QR Code desconectado(s)`);
  if (s.ia?.bloqueado) alertas.push(`IA desligada para todos: teto diário de ${s.ia.teto.toLocaleString('pt-BR')} tokens atingido`);
  if (s.notasRejeitadas?.total) alertas.push(`${s.notasRejeitadas.total} nota(s) fiscal(is) com erro nas últimas 24 h`);
  if (s.recursos.sistema.memoriaUsadaPct >= 85) alertas.push(`Memória do servidor em ${s.recursos.sistema.memoriaUsadaPct}%`);
  return alertas;
}

module.exports = { situacaoGeral, alertasDaSaude, recursos, versaoDoApp };

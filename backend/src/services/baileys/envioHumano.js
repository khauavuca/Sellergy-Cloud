// =====================================================================
// ENVIO HUMANO — como o canal QR Code (WhatsApp Web, Baileys) manda mensagem
// sem parecer robo e sem queimar o numero do cliente.
// =====================================================================
// O WhatsApp derruba numeros que mandam rajada, mandam pra quem nao tem
// WhatsApp, mandam o mesmo texto pra todo mundo ou recebem muita denuncia.
// Cada regra daqui ataca uma dessas causas:
//
//   1. Espacamento por numero (Redis): nunca 2 mensagens do mesmo numero em
//      menos de N segundos, com variacao aleatoria. Vale entre processos.
//   2. "Digitando..." antes de enviar, com tempo proporcional ao texto.
//   3. Cota diaria de campanha com aquecimento: numero recem-conectado manda
//      pouco e vai subindo. Passou da cota, o resto fica pro dia seguinte.
//   4. Campanha so em horario comercial (08h-20h, horario de Brasilia).
//   5. Confere se o numero tem WhatsApp antes (cache de 30 dias).
//   6. Variacao de texto {Oi|Ola|E ai} pra nenhuma mensagem sair identica.
//   7. Disjuntor: muitas falhas seguidas pausam a campanha daquele numero.
//   8. Quem responde SAIR/PARAR nunca mais recebe campanha (OptOutWhatsapp).
//
// Mensagem 1 a 1 que o cliente espera (lembrete, resposta, confirmacao) usa
// espacamento curto e nao conta na cota de campanha.
// =====================================================================

const IORedis = require('ioredis');

const ESPACO = {
  // [minimo, maximo] em ms entre duas mensagens do mesmo numero
  conversa: [2_500, 6_000],
  lembrete: [6_000, 15_000],
  campanha: [25_000, 55_000],
};

// Aquecimento: dias desde que o numero conectou -> campanhas por dia.
const AQUECIMENTO = [
  [3, 30],
  [7, 80],
  [14, 180],
  [30, 300],
  [Infinity, 450],
];

const HORARIO_CAMPANHA = { inicio: 8, fim: 20 };
const DISJUNTOR = { falhas: 5, pausaMs: 60 * 60 * 1000 };
const TTL_TEM_WHATSAPP_S = 30 * 24 * 3600;

let redis = null;
function obterRedis() {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 3, lazyConnect: false });
    redis.on('error', (e) => console.error('[envioHumano/redis]', e?.message));
  }
  return redis;
}

function aleatorio(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Reserva atomica do proximo horario livre de um numero. Devolve quanto
// esperar (ms) ate a vez desta mensagem. Corrida entre processos e resolvida
// pelo proprio Redis (script unico).
const SCRIPT_RESERVA = `
local agora = tonumber(ARGV[1])
local espaco = tonumber(ARGV[2])
local proximo = tonumber(redis.call('GET', KEYS[1]) or '0')
local vez = math.max(agora, proximo)
redis.call('SET', KEYS[1], vez + espaco, 'PX', espaco + 3600000)
return vez - agora
`;

/**
 * Espera a vez deste numero (bloqueia so a chamada atual).
 * @param {string} numero  numero conectado (dono do socket)
 * @param {'conversa'|'lembrete'|'campanha'} tipo
 */
async function aguardarVez(numero, tipo = 'conversa') {
  const [min, max] = ESPACO[tipo] || ESPACO.conversa;
  try {
    const espera = await obterRedis().eval(SCRIPT_RESERVA, 1, `wa:vez:${numero}`, Date.now(), aleatorio(min, max));
    if (espera > 0) await dormir(Math.min(Number(espera), 10 * 60 * 1000));
  } catch (e) {
    // Sem Redis, ao menos um respiro local.
    console.error('[envioHumano/aguardarVez]', e?.message);
    await dormir(aleatorio(min, max));
  }
}

/** Mostra "digitando..." por um tempo proporcional ao texto. */
async function simularDigitacao(sock, jid, texto = '') {
  try {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate('composing', jid);
    const ms = Math.min(7_000, 1_200 + String(texto).length * aleatorio(25, 45));
    await dormir(ms);
    await sock.sendPresenceUpdate('paused', jid);
  } catch {
    // presenca e cosmetica: falhar aqui nunca impede o envio
  }
}

/** {Oi|Ola|E ai}, tudo bem? -> uma das opcoes, sorteada por mensagem. */
function variarTexto(texto) {
  let t = String(texto || '');
  // resolve de dentro pra fora (permite {a|{b|c}})
  for (let i = 0; i < 10 && /\{[^{}]*\|[^{}]*\}/.test(t); i += 1) {
    t = t.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, grupo) => {
      const ops = grupo.split('|');
      return ops[Math.floor(Math.random() * ops.length)];
    });
  }
  return t;
}

/** Confere (com cache) se o numero tem WhatsApp. Na duvida, deixa passar. */
async function temWhatsapp(sock, digitos) {
  const chave = `wa:existe:${digitos}`;
  try {
    const cache = await obterRedis().get(chave);
    if (cache !== null) return cache === '1';
    const [r] = await sock.onWhatsApp(`${digitos}@s.whatsapp.net`);
    const existe = Boolean(r?.exists);
    await obterRedis().set(chave, existe ? '1' : '0', 'EX', TTL_TEM_WHATSAPP_S);
    return existe;
  } catch {
    return true;
  }
}

function dataSP(agora = new Date()) {
  // yyyymmdd e hora no fuso de Brasilia, independente do fuso do container.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(agora).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return { dia: `${partes.year}${partes.month}${partes.day}`, hora: Number(partes.hour) % 24 };
}

function cotaPorIdade(diasConectado) {
  return AQUECIMENTO.find(([ate]) => diasConectado < ate)[1];
}

/** Marca (uma vez) desde quando o numero esta conectado. */
async function registrarConexao(numero) {
  try { await obterRedis().set(`wa:desde:${numero}`, String(Date.now()), 'NX'); } catch { /* ignora */ }
}

/**
 * Pode mandar 1 mensagem de campanha agora? Se nao, diz quanto esperar.
 * Conta a mensagem na cota do dia quando libera.
 * @returns {Promise<{ agora: true } | { agora: false, esperarMs: number, motivo: string }>}
 */
async function reservarCampanha(numero, agoraData = new Date()) {
  const r = obterRedis();
  const pausa = Number(await r.pttl(`wa:pausa:${numero}`));
  if (pausa > 0) return { agora: false, esperarMs: pausa, motivo: 'DISJUNTOR' };

  const { dia, hora } = dataSP(agoraData);
  if (hora < HORARIO_CAMPANHA.inicio || hora >= HORARIO_CAMPANHA.fim) {
    const horasAte = hora < HORARIO_CAMPANHA.inicio ? HORARIO_CAMPANHA.inicio - hora : 24 - hora + HORARIO_CAMPANHA.inicio;
    return { agora: false, esperarMs: horasAte * 3600_000 + aleatorio(0, 40 * 60_000), motivo: 'FORA_DO_HORARIO' };
  }

  const desde = Number(await r.get(`wa:desde:${numero}`)) || Date.now();
  const dias = Math.floor((Date.now() - desde) / 86_400_000);
  const chaveCota = `wa:cota:${numero}:${dia}`;
  const usados = await r.incr(chaveCota);
  if (usados === 1) await r.expire(chaveCota, 2 * 86_400);
  if (usados > cotaPorIdade(dias)) {
    await r.decr(chaveCota);
    // amanha, no comeco do horario, espalhado
    const horasAte = 24 - hora + HORARIO_CAMPANHA.inicio;
    return { agora: false, esperarMs: horasAte * 3600_000 + aleatorio(0, 90 * 60_000), motivo: 'COTA_DO_DIA' };
  }
  return { agora: true };
}

async function registrarResultado(numero, ok) {
  try {
    const r = obterRedis();
    const chave = `wa:falhas:${numero}`;
    if (ok) { await r.del(chave); return; }
    const n = await r.incr(chave);
    await r.expire(chave, 3600);
    if (n >= DISJUNTOR.falhas) {
      await r.set(`wa:pausa:${numero}`, '1', 'PX', DISJUNTOR.pausaMs);
      await r.del(chave);
      console.warn(`[envioHumano] ${DISJUNTOR.falhas} falhas seguidas no numero ...${String(numero).slice(-4)}: campanha pausada por 1 h.`);
    }
  } catch { /* ignora */ }
}

const PALAVRAS_SAIR = new Set(['sair', 'parar', 'pare', 'stop', 'descadastrar', 'nao quero', 'não quero', 'cancelar mensagens']);

function ehPedidoDeSaida(texto) {
  return PALAVRAS_SAIR.has(String(texto || '').trim().toLowerCase().replace(/[.!]+$/g, ''));
}

module.exports = {
  aguardarVez,
  simularDigitacao,
  variarTexto,
  temWhatsapp,
  reservarCampanha,
  registrarConexao,
  registrarResultado,
  ehPedidoDeSaida,
  cotaPorIdade,
  dataSP,
  ESPACO,
  AQUECIMENTO,
};

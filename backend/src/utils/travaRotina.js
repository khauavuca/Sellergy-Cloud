// Trava entre processos para rotinas por timer (Redis SET NX PX).
//
// Com 2+ instancias (worker ou API) cada uma tem o seu setInterval/setTimeout:
// sem trava, a mesma rotina roda em dobro (nota emitida duas vezes, aviso
// repetido, fatura duplicada). Aqui so quem pega a chave no Redis roda.
//
//   await comTrava('fiscal-emitir-sozinho', () => emitirVendasPendentes(), {
//     ttlMs: 2 * 60_000,       // vida da chave; renovada enquanto a rotina roda
//     manterPorMs: 90_000,     // segura a chave ate X ms depois do inicio, mesmo
//   });                        // que termine antes (1 rodada por janela no cluster)
//
// Redis fora do ar: a rodada e PULADA (log), nunca roda sem trava. O processo
// nao cai (a conexao tem handler de erro).

const crypto = require('crypto');

const PREFIXO = 'sellergy:trava:rotina:';

// Libera so se a chave ainda e nossa.
const LUA_LIBERAR = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
// Renova (ou encurta) a vida so se a chave ainda e nossa.
const LUA_RENOVAR = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

let redisPadrao = null;
function obterRedisPadrao() {
  if (!redisPadrao) {
    const { criarConexaoRedis } = require('../filas');
    redisPadrao = criarConexaoRedis();
  }
  return redisPadrao;
}

const ultimoAvisoRedis = new Map();
function avisarRedisFora(nome, e) {
  const agora = Date.now();
  if (agora - (ultimoAvisoRedis.get(nome) || 0) < 5 * 60_000) return;
  ultimoAvisoRedis.set(nome, agora);
  console.error(`[trava:${nome}] Redis indisponível, rodada pulada:`, e?.message);
}

/**
 * Roda `fn` so se conseguir a trava `nome`.
 * @returns {Promise<{ rodou: boolean, resultado?: any, motivo?: 'OCUPADA'|'REDIS_INDISPONIVEL' }>}
 */
async function comTrava(nome, fn, {
  ttlMs = 5 * 60_000, manterPorMs = 0, redis = null, agora = () => Date.now(),
} = {}) {
  const r = redis || obterRedisPadrao();
  const chave = `${PREFIXO}${nome}`;
  const token = crypto.randomBytes(12).toString('hex');
  const inicio = agora();

  let ok;
  try {
    ok = await r.set(chave, token, 'PX', ttlMs, 'NX');
  } catch (e) {
    avisarRedisFora(nome, e);
    return { rodou: false, motivo: 'REDIS_INDISPONIVEL' };
  }
  if (ok !== 'OK') return { rodou: false, motivo: 'OCUPADA' };

  // Rotina longa: renova a chave a cada 1/3 do ttl para ninguem entrar no meio.
  const renovar = setInterval(() => {
    r.eval(LUA_RENOVAR, 1, chave, token, String(ttlMs)).catch(() => {});
  }, Math.max(1000, Math.floor(ttlMs / 3)));
  if (typeof renovar.unref === 'function') renovar.unref();

  try {
    const resultado = await fn();
    return { rodou: true, resultado };
  } finally {
    clearInterval(renovar);
    const resta = manterPorMs - (agora() - inicio);
    try {
      if (resta > 0) await r.eval(LUA_RENOVAR, 1, chave, token, String(Math.ceil(resta)));
      else await r.eval(LUA_LIBERAR, 1, chave, token);
    } catch (_) {
      // Sem Redis para liberar: a chave expira sozinha pelo ttl.
    }
  }
}

/** Mesmo que comTrava, mas devolve uma funcao (para setInterval/setTimeout). */
function envolverComTrava(nome, fn, opcoes) {
  return () => comTrava(nome, fn, opcoes);
}

/**
 * setInterval com trava entre processos e sem sobreposicao no proprio processo.
 * Erro da rotina vira log (nunca derruba o processo).
 * @returns {() => void} parar
 */
function iniciarIntervaloComTrava({ nome, intervaloMs, rodar, primeiraEmMs = null, ttlMs, manterPorMs }) {
  let rodando = false;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      await comTrava(nome, rodar, {
        ttlMs: ttlMs || Math.max(60_000, intervaloMs),
        manterPorMs: manterPorMs ?? Math.floor(intervaloMs * 0.8),
      });
    } catch (e) {
      console.error(`[rotina:${nome}]`, e?.message);
    } finally {
      rodando = false;
    }
  };
  const id = setInterval(tick, intervaloMs);
  const primeira = primeiraEmMs !== null ? setTimeout(tick, primeiraEmMs) : null;
  return () => { clearInterval(id); if (primeira) clearTimeout(primeira); };
}

/** Milissegundos ate a proxima `hora`:00 local. */
function msAteProximaHora(hora, agora = new Date()) {
  const proxima = new Date(agora);
  proxima.setHours(hora, 0, 0, 0);
  if (proxima <= agora) proxima.setDate(proxima.getDate() + 1);
  return proxima.getTime() - agora.getTime();
}

/**
 * Rotina diaria (hora local) com trava: 2 instancias disparando juntas -> so
 * uma roda; a chave fica presa por `manterPorMs` (padrao 1 h).
 */
function agendarDiarioComTrava({ nome, hora, rodar, manterPorMs = 60 * 60_000, ttlMs = 15 * 60_000 }) {
  let timer = null;
  const agendar = () => {
    timer = setTimeout(async () => {
      try {
        await comTrava(nome, rodar, { ttlMs, manterPorMs });
      } catch (e) {
        console.error(`[rotina:${nome}]`, e?.message);
      }
      agendar();
    }, msAteProximaHora(hora));
  };
  agendar();
  return () => clearTimeout(timer);
}

module.exports = {
  PREFIXO,
  comTrava,
  envolverComTrava,
  iniciarIntervaloComTrava,
  agendarDiarioComTrava,
  msAteProximaHora,
};

// =====================================================================
// PORTA DO PAINEL ADMIN
// =====================================================================
// Três travas a mais no login da equipe Sellergy (perfil ADMIN), além da
// senha, do código em 2 etapas e do limite por IP:
//
//  1. Origem: com ADMIN_ORIGENS definido, a conta ADMIN só entra quando o
//     pedido vem de um desses sites (ex.: https://crm.sellergycloud.com).
//     Do site do cliente a resposta é a mesma de senha errada.
//  2. Bloqueio por conta: depois de ADMIN_MAX_FALHAS erros (senha ou código)
//     a conta trava por ADMIN_BLOQUEIO_MIN minutos, venha de quantos IPs vier.
//  3. Auditoria: login, erro e bloqueio viram linha em AuditoriaAdmin.
//
// O Redis guarda os contadores. Se ele cair, o bloqueio por conta fica
// desligado (o resto continua valendo) em vez de travar o login de todo mundo.
// =====================================================================

const crypto = require('crypto');
const { registrarAuditoria } = require('./auditoria');

const MAX_FALHAS = Math.max(1, Number(process.env.ADMIN_MAX_FALHAS) || 5);
const BLOQUEIO_SEG = Math.max(60, (Number(process.env.ADMIN_BLOQUEIO_MIN) || 30) * 60);

let redis = null;
function obterRedis() {
  if (!redis) {
    const IORedis = require('ioredis');
    redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
    redis.on('error', () => {});
  }
  return redis;
}

/** Lista de origens liberadas pro login ADMIN. Vazia = sem restrição (dev). PURA. */
function origensAdmin(valor = process.env.ADMIN_ORIGENS) {
  return String(valor || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, '').toLowerCase())
    .filter(Boolean);
}

/** O pedido veio de um site liberado pro admin? PURA. */
function origemLiberada(origem, lista = origensAdmin()) {
  if (lista.length === 0) return true;
  if (!origem) return false;
  return lista.includes(String(origem).trim().replace(/\/$/, '').toLowerCase());
}

function chaveFalhas(usuarioId) {
  const h = crypto.createHash('sha256').update(String(usuarioId)).digest('hex').slice(0, 24);
  return `admin:falhas:${h}`;
}

/** Segundos que faltam do bloqueio, ou 0 se a conta está liberada. */
async function segundosBloqueado(usuarioId) {
  try {
    const r = obterRedis();
    const falhas = Number(await r.get(chaveFalhas(usuarioId))) || 0;
    if (falhas < MAX_FALHAS) return 0;
    const ttl = await r.ttl(chaveFalhas(usuarioId));
    return ttl > 0 ? ttl : 0;
  } catch {
    return 0;
  }
}

/** Soma um erro. Devolve true quando esse erro acabou de travar a conta. */
async function registrarFalha(usuarioId) {
  try {
    const r = obterRedis();
    const chave = chaveFalhas(usuarioId);
    const total = await r.incr(chave);
    // A janela começa no primeiro erro e é renovada quando trava.
    if (total === 1 || total === MAX_FALHAS) await r.expire(chave, BLOQUEIO_SEG);
    return total === MAX_FALHAS;
  } catch {
    return false;
  }
}

async function limparFalhas(usuarioId) {
  try {
    await obterRedis().del(chaveFalhas(usuarioId));
  } catch {
    /* fail-open */
  }
}

function mensagemBloqueio(segundos) {
  const min = Math.max(1, Math.ceil(segundos / 60));
  return `Acesso bloqueado por segurança depois de várias tentativas erradas. Tente de novo em ${min} min.`;
}

/** Grava na auditoria em nome do admin (o pedido ainda não tem sessão). */
function auditar(req, usuario, acao, detalhes = {}) {
  const reqAdmin = { ip: req.ip, socket: req.socket, usuario: { id: usuario.id, nome: usuario.nome } };
  return registrarAuditoria(reqAdmin, {
    acao,
    alvoTipo: 'USUARIO',
    alvoId: usuario.id,
    detalhes: { origem: req.get?.('origin') || null, navegador: String(req.get?.('user-agent') || '').slice(0, 200), ...detalhes },
  });
}

module.exports = {
  MAX_FALHAS,
  origensAdmin,
  origemLiberada,
  segundosBloqueado,
  registrarFalha,
  limparFalhas,
  mensagemBloqueio,
  auditar,
};

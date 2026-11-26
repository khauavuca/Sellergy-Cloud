// =====================================================================
// SESSAO DO USUARIO — o que vale e o que esta no BANCO, nao no token.
// =====================================================================
// O token (7 dias) carrega so id, perfil e clienteId do momento do login. Sem
// esta camada, quem era rebaixado ou excluido da equipe continuava com o acesso
// antigo ate o token vencer, e sair/trocar a senha nao derrubava nada.
//
//   - A cada pedido o auth.middleware carrega o usuario daqui (cache em memoria
//     de 30 s por usuario): se nao existe mais, 401; perfil, clienteId e
//     permissoes passam a ser os do banco.
//   - versaoSessao: vai no token como `sv`. Trocar a senha, mudar o papel ou a
//     dona redefinir a senha de alguem soma 1 (incrementarVersao) e todas as
//     sessoes antigas daquele usuario caem na hora.
//   - Sair (logout): o token vai pra uma lista negra no Redis ate expirar
//     (chave = hash do token, entao vale tambem pra token antigo sem `jti`).
//
// Quem muda perfil/permissoes/senha chama invalidar(id) (mesmo processo) — os
// outros processos pegam a mudanca em no maximo 30 s (TTL do cache).
// =====================================================================

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TTL_CACHE_MS = 30 * 1000;
const MAX_CACHE = 5000;
const PREFIXO_REVOGADO = 'sessao:revogada:';

// Carregados sob demanda: o modulo e importado por testes puros (sem banco).
let prismaCache = null;
function obterPrisma() {
  if (!prismaCache) prismaCache = require('../prisma');
  return prismaCache;
}

let redis = null;
function obterRedis() {
  if (redis === null) {
    try {
      const IORedis = require('ioredis');
      redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        retryStrategy: (n) => (n > 3 ? null : 200),
      });
      redis.on('error', () => {});
    } catch {
      redis = false;
    }
  }
  return redis || null;
}

// ---------------------------------------------------------------------
// Cache curto do usuario (por processo)
// ---------------------------------------------------------------------

const cache = new Map(); // id -> { em, dados }

const CAMPOS = {
  id: true, perfil: true, clienteId: true, permissoes: true, versaoSessao: true, deveTrocarSenha: true,
};

/** Usuario atual do banco (cache de 30 s). null = nao existe mais. */
async function carregarUsuario(id, { agora = Date.now(), forcar = false } = {}) {
  if (!id) return null;
  const guardado = cache.get(id);
  if (!forcar && guardado && agora - guardado.em < TTL_CACHE_MS) return guardado.dados;
  const dados = await obterPrisma().usuario.findUnique({ where: { id }, select: CAMPOS });
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(id, { em: agora, dados: dados || null });
  return dados || null;
}

/** Esquece o usuario do cache (chamar depois de mudar perfil/permissoes/senha). */
function invalidar(id) {
  if (id) cache.delete(id);
}

function limparCache() {
  cache.clear();
}

/**
 * Soma 1 na versao da sessao (derruba os tokens antigos) e limpa o cache.
 * `tx` opcional (dentro de uma transacao). Devolve a versao nova.
 */
async function incrementarVersao(id, tx = null) {
  const cliente = tx || obterPrisma();
  const r = await cliente.usuario.update({ where: { id }, data: { versaoSessao: { increment: 1 } }, select: { versaoSessao: true } });
  invalidar(id);
  return r.versaoSessao;
}

// ---------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------

/** Versao gravada no token (token antigo, sem `sv`, conta como 0). PURA. */
function versaoDoToken(dados) {
  return Number.isInteger(dados?.sv) ? dados.sv : 0;
}

/**
 * Confere o token contra o usuario do banco. PURA.
 * @returns {{ ok: true } | { ok: false, motivo: 'INEXISTENTE'|'VERSAO'|'CLIENTE' }}
 */
function conferirSessao(dados, usuario) {
  if (!usuario) return { ok: false, motivo: 'INEXISTENTE' };
  if (versaoDoToken(dados) !== (usuario.versaoSessao || 0)) return { ok: false, motivo: 'VERSAO' };
  // Usuario mudou de negocio (ou perdeu o negocio): sessao antiga nao serve.
  if ((dados?.clienteId || null) !== (usuario.clienteId || null)) return { ok: false, motivo: 'CLIENTE' };
  return { ok: true };
}

// Com a senha provisoria (deveTrocarSenha) a pessoa so alcanca o necessario
// pra trocar a senha: ver o perfil, trocar a senha e sair.
const ROTAS_LIBERADAS_TROCA_SENHA = [
  { metodo: 'GET', re: /^\/autenticacao\/perfil$/ },
  { metodo: 'PUT', re: /^\/autenticacao\/perfil$/ },
  { metodo: 'POST', re: /^\/autenticacao\/(trocar-senha|logout)$/ },
];

/** A rota pode ser usada por quem ainda precisa trocar a senha? PURA. */
function rotaLiberadaSemTrocarSenha(metodo, caminho) {
  const c = String(caminho || '').split('?')[0];
  const m = String(metodo || '').toUpperCase();
  if (m === 'OPTIONS' || m === 'HEAD') return true;
  return ROTAS_LIBERADAS_TROCA_SENHA.some((r) => r.metodo === m && r.re.test(c));
}

// ---------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------

/** Assina o token de sessao com a versao atual do usuario. */
function assinarToken(usuario, segredo, { mfa = false } = {}) {
  return jwt.sign(
    {
      id: usuario.id,
      perfil: usuario.perfil,
      clienteId: usuario.clienteId || null,
      mfa,
      sv: Number.isInteger(usuario.versaoSessao) ? usuario.versaoSessao : 0,
      jti: crypto.randomUUID(),
    },
    segredo,
    { expiresIn: usuario.perfil === 'ADMIN' ? '12h' : '7d' },
  );
}

function chaveRevogado(token) {
  return PREFIXO_REVOGADO + crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Coloca o token na lista negra ate ele vencer. Token invalido/expirado nao
 * precisa (ja nao abre nada). Nunca lanca: falha do Redis so e registrada.
 */
async function revogarToken(token, segredo, agora = Date.now()) {
  if (!token) return false;
  let dados;
  try {
    dados = jwt.verify(token, segredo);
  } catch {
    return false;
  }
  const restaSeg = Math.ceil((Number(dados.exp) * 1000 - agora) / 1000);
  if (!(restaSeg > 0)) return false;
  const r = obterRedis();
  if (!r) return false;
  try {
    await r.set(chaveRevogado(token), '1', 'EX', restaSeg);
    return true;
  } catch (e) {
    console.error('[sessao] nao deu pra revogar o token', e?.message);
    return false;
  }
}

/** O token foi encerrado (logout)? Redis fora do ar = nao revogado (segue). */
async function tokenRevogado(token) {
  const r = obterRedis();
  if (!r || !token) return false;
  try {
    return (await r.exists(chaveRevogado(token))) === 1;
  } catch {
    return false;
  }
}

module.exports = {
  TTL_CACHE_MS,
  carregarUsuario,
  invalidar,
  limparCache,
  incrementarVersao,
  versaoDoToken,
  conferirSessao,
  rotaLiberadaSemTrocarSenha,
  assinarToken,
  revogarToken,
  tokenRevogado,
  chaveRevogado,
  // testes
  _cache: cache,
  _definirPrisma: (p) => { prismaCache = p; },
  _definirRedis: (r) => { redis = r; },
};

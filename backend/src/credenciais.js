// Helper para acessar credenciais cifradas just-in-time: adaptadores de PSP,
// fiscal e WhatsApp decifram a chave do tenant no momento da chamada externa;
// o atendimento com IA decifra a chave de plataforma (DeepSeek).
//
// Filosofia: credenciais saem do banco em texto cifrado, sao decifradas
// no momento do uso, e o resultado em claro NUNCA e logado, persistido nem
// retornado pelas rotas de leitura.
//
// Cache em memoria do resultado decifrado. Motivo: no caminho quente (toda
// mensagem respondida por IA, todo webhook da Meta) a credencial era buscada
// no banco, decifrada (HKDF + AES-GCM) e ainda gerava um UPDATE de
// `ultimoUsoEm` — tudo isso por mensagem. A credencial muda raramente;
// segurar o resultado alguns segundos corta 2 idas ao banco por mensagem sem
// mudar nada visivel. Regras:
//   - Plataforma (1 chave, da Sellergy): TTL longo, invalidado ao salvar.
//   - Tenant: TTL curto (60s). Rotacao de token feita pelo cliente passa a
//     valer em ate 1 min — sem invalidacao explicita pra nao acoplar as rotas.
//   - WHATSAPP_BAILEYS_SESSION NUNCA entra no cache: e o estado da sessao do
//     WhatsApp Web, reescrito pelo proprio gerenciador (authStateStore) a cada
//     poucos segundos — servir uma copia velha numa reconexao dessincroniza a
//     sessao e derruba o bot.
//   - `ultimoUsoEm` e gravado no maximo 1x por minuto por credencial.

const prisma = require('./prisma');
const { cifrarPayload, decifrarPayload } = require('./cripto/cofreCredenciais');

// Contexto fixo de derivacao pra credencial de PLATAFORMA (ex.: a chave da
// DeepSeek — uma so, da Sellergy, nao de um tenant). O parametro "clienteId"
// que cifrarPayload/decifrarPayload recebem e usado como contexto de
// derivacao HKDF (nao precisa ser segredo, so precisa ser estavel e unico
// pra esse dominio — HKDF.info e publico por design, a seguranca vem da
// master key). Nao reaproveita nenhum clienteId real: uma string fixa que
// nunca colide com um UUID de tenant.
//
// Isolado deste jeito, em vez de reabrir o caminho "clienteId null" em
// carregarCredencialDecifrada(), porque aquele foi fechado de proposito no
// pivo (comentario ali: "credenciais de plataforma foram removidas") — nao
// quero reabrir uma trava geral pra resolver um caso especifico.
const CONTEXTO_PLATAFORMA = 'sellergy-plataforma-v1';

const TTL_PLATAFORMA_MS = 5 * 60_000;
const TTL_TENANT_MS = 60_000;
const INTERVALO_ULTIMO_USO_MS = 60_000;
const TIPOS_SEM_CACHE = new Set(['WHATSAPP_BAILEYS_SESSION']);

const cacheDecifradas = new Map(); // chave -> { valor, expiraEm }
const ultimoUsoGravadoEm = new Map(); // credencialId -> timestamp ms

function lerCache(chave) {
  const entrada = cacheDecifradas.get(chave);
  if (!entrada) return null;
  if (entrada.expiraEm <= Date.now()) {
    cacheDecifradas.delete(chave);
    return null;
  }
  return entrada.valor;
}

function gravarCache(chave, valor, ttlMs) {
  cacheDecifradas.set(chave, { valor, expiraEm: Date.now() + ttlMs });
}

// Stats em background, no maximo 1x/min por credencial — silencioso se falhar.
function registrarUso(credencialId) {
  const agora = Date.now();
  if (agora - (ultimoUsoGravadoEm.get(credencialId) || 0) < INTERVALO_ULTIMO_USO_MS) return;
  ultimoUsoGravadoEm.set(credencialId, agora);
  prisma.credencial
    .update({ where: { id: credencialId }, data: { ultimoUsoEm: new Date(agora) } })
    .catch((e) => console.error('[credencial/stats]', e?.message || e));
}

async function carregarCredencialDecifrada({ credencialId, clienteId }) {
  if (!credencialId) return null;

  const chaveCache = `tenant:${clienteId || '-'}:${credencialId}`;
  const emCache = lerCache(chaveCache);
  if (emCache) {
    registrarUso(credencialId);
    return emCache;
  }

  const credencial = await prisma.credencial.findFirst({
    where: clienteId ? { id: credencialId, clienteId } : { id: credencialId },
  });
  if (!credencial) {
    throw new Error(`Credencial ${credencialId} nao encontrada (ou nao pertence ao tenant).`);
  }
  // Cifra derivada por tenant. Credenciais de plataforma (clienteId null) foram
  // removidas no pivô — toda credencial agora pertence a um tenant.
  if (!credencial.clienteId) {
    throw new Error(`Credencial ${credencialId} sem tenant — credenciais de plataforma foram removidas.`);
  }
  let dados;
  try {
    dados = decifrarPayload(credencial.clienteId, credencial);
  } catch (err) {
    throw new Error(`Falha ao decifrar credencial ${credencialId}: ${err.message}`);
  }

  registrarUso(credencial.id);

  const resultado = { tipo: credencial.tipo, nome: credencial.nome, dados };
  if (!TIPOS_SEM_CACHE.has(credencial.tipo)) gravarCache(chaveCache, resultado, TTL_TENANT_MS);
  return resultado;
}

/**
 * Carrega a UNICA credencial de plataforma de um tipo (ex.: DEEPSEEK_KEY).
 * Diferente de carregarCredencialDecifrada: nao recebe id nem clienteId —
 * a credencial de plataforma nao pertence a nenhum tenant, entao a busca e
 * so pelo tipo, com clienteId IS NULL.
 */
async function carregarCredencialPlataforma(tipo) {
  const chaveCache = `plataforma:${tipo}`;
  const emCache = lerCache(chaveCache);
  if (emCache) {
    registrarUso(emCache.id);
    return emCache;
  }

  const credencial = await prisma.credencial.findFirst({
    where: { clienteId: null, tipo },
    orderBy: { criadoEm: 'desc' },
  });
  if (!credencial) return null;

  let dados;
  try {
    dados = decifrarPayload(CONTEXTO_PLATAFORMA, credencial);
  } catch (err) {
    throw new Error(`Falha ao decifrar credencial de plataforma (${tipo}): ${err.message}`);
  }

  registrarUso(credencial.id);

  const resultado = { id: credencial.id, tipo: credencial.tipo, nome: credencial.nome, dados };
  gravarCache(chaveCache, resultado, TTL_PLATAFORMA_MS);
  return resultado;
}

/**
 * Cria ou atualiza a UNICA credencial de plataforma de um tipo. Usado pela
 * rota admin (admin-credencial-ia.routes.js) — nunca exposta ao tenant.
 */
async function salvarCredencialPlataforma({ tipo, nome, payload, criadoPorId }) {
  const cifrado = cifrarPayload(CONTEXTO_PLATAFORMA, payload);
  const existente = await prisma.credencial.findFirst({ where: { clienteId: null, tipo } });

  const data = {
    nome,
    tipo,
    dadosCifrados: cifrado.conteudoCifrado,
    iv: cifrado.iv,
    tag: cifrado.tag,
    versaoChave: cifrado.versaoChave,
  };

  cacheDecifradas.delete(`plataforma:${tipo}`); // a proxima leitura ve a chave nova

  if (existente) {
    return prisma.credencial.update({ where: { id: existente.id }, data });
  }
  return prisma.credencial.create({ data: { ...data, clienteId: null, criadoPorId: criadoPorId || null } });
}

/** Esvazia o cache — pra testes e pra rotas que rotacionam credencial de tenant. */
function limparCacheCredenciais() {
  cacheDecifradas.clear();
}

module.exports = {
  carregarCredencialDecifrada,
  carregarCredencialPlataforma,
  salvarCredencialPlataforma,
  limparCacheCredenciais,
};

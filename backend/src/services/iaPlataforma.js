// IA da plataforma (Admin › Integracoes): qual provedor atende os bots e com
// qual modelo. Fica DENTRO da credencial cifrada DEEPSEEK_KEY (o nome do tipo
// ficou historico): dados = { apiKey, provedor?, modelo? }.
//   - DEEPSEEK (padrao): api.deepseek.com, modelo vem de cada bot (iaModelo).
//   - OPENROUTER: openrouter.ai, um modelo so pra plataforma inteira,
//     escolhido da lista deles (so os que aceitam "tools" — sem isso o bot
//     nao marca horario nem consulta produto).

const { fetchComRetentativa } = require('../utils/httpSeguro');

const PROVEDORES_IA = Object.freeze({
  DEEPSEEK: { nome: 'DeepSeek', base: 'https://api.deepseek.com' },
  OPENROUTER: { nome: 'OpenRouter', base: 'https://openrouter.ai/api/v1' },
});

const RE_MODELO = /^[a-z0-9._/:-]{1,100}$/i;

/** Regra pura: valida o que veio da tela. Retorna { provedor, modelo } ou { erro }. */
function validarConfigIA({ provedor, modelo } = {}) {
  const p = String(provedor || 'DEEPSEEK').toUpperCase();
  if (!PROVEDORES_IA[p]) return { erro: 'Provedor de IA desconhecido.' };
  if (p === 'DEEPSEEK') return { provedor: p, modelo: null };
  const m = String(modelo || '').trim();
  if (!RE_MODELO.test(m)) return { erro: 'Escolha o modelo do OpenRouter.' };
  return { provedor: p, modelo: m };
}

/** Regra pura: provedor/modelo efetivos a partir dos dados decifrados da credencial. */
function configDaCredencial(dados) {
  const p = PROVEDORES_IA[dados?.provedor] ? dados.provedor : 'DEEPSEEK';
  const modelo = p === 'OPENROUTER' && RE_MODELO.test(String(dados?.modelo || '')) ? dados.modelo : null;
  return { provedor: p, modelo };
}

/** Preco por token (string em USD) → USD por milhao, 2 casas. */
function porMilhao(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 100) / 100 : null;
}

/**
 * Regra pura: lista crua do OpenRouter → so os que aceitam tools, gratis
 * primeiro, depois os mais baratos.
 */
function filtrarModelosOpenRouter(lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter((m) => m && RE_MODELO.test(String(m.id || '')) && (m.supported_parameters || []).includes('tools'))
    .map((m) => {
      const entrada = porMilhao(m.pricing?.prompt);
      const saida = porMilhao(m.pricing?.completion);
      return {
        id: m.id,
        nome: String(m.name || m.id).slice(0, 120),
        gratis: String(m.id).endsWith(':free') || (entrada === 0 && saida === 0),
        entrada,
        saida,
        contexto: Number(m.context_length) || null,
      };
    })
    .sort((a, b) => (b.gratis - a.gratis) || ((a.entrada ?? 1e9) - (b.entrada ?? 1e9)) || a.id.localeCompare(b.id));
}

let cacheModelos = { em: 0, lista: null };
const CACHE_MS = 30 * 60 * 1000;

/** Lista publica de modelos do OpenRouter (sem chave), em cache por 30 min. */
async function modelosOpenRouter({ agora = Date.now(), buscar = fetchComRetentativa } = {}) {
  if (cacheModelos.lista && agora - cacheModelos.em < CACHE_MS) return cacheModelos.lista;
  const resp = await buscar(`${PROVEDORES_IA.OPENROUTER.base}/models`, { method: 'GET' }, { timeoutMs: 15_000 });
  if (!resp.ok) throw Object.assign(new Error(`OpenRouter HTTP ${resp.status}`), { status: 502 });
  const json = await resp.json();
  const lista = filtrarModelosOpenRouter(json?.data);
  cacheModelos = { em: agora, lista };
  return lista;
}

/** Mensagem curta e legivel do erro devolvido pelo provedor (sem segredo). */
function mensagemDoErro(err) {
  const d = err?.detalhe;
  const msg = d?.error?.message || d?.message || err?.message || 'Erro desconhecido.';
  return String(msg).slice(0, 300);
}

module.exports = {
  PROVEDORES_IA,
  validarConfigIA,
  configDaCredencial,
  filtrarModelosOpenRouter,
  modelosOpenRouter,
  mensagemDoErro,
  _limparCache: () => { cacheModelos = { em: 0, lista: null }; },
};

// Adapter DeepSeek — implementa ProvedorIA.
// Auth: Bearer apiKey. Base: https://api.deepseek.com
// Docs oficiais (consultadas em jul/2026): POST /chat/completions, formato
// compativel com OpenAI. Modelos atuais: deepseek-v4-flash (economico) e
// deepseek-v4-pro (mais capaz). Sem stream aqui — o chat do bot precisa da
// resposta completa (e do usage) de uma vez, nao de tokens parciais.
//
// Tool calling: tambem no formato OpenAI (tools no request, tool_calls na
// resposta — a doc da propria DeepSeek confirma isso, guia /guides/tool_calls).
// O modelo NUNCA executa a ferramenta sozinho; so devolve o pedido. Quem
// executa e decide o loop e o iaRouter.js (ver processarComFerramentas).
//
// Preco por milhao de tokens (referencia — cobrado em USD pela DeepSeek; o
// preco do EXCEDENTE que a Sellergy repassa ao cliente e configurado em BRL
// no proprio Bot, nao aqui — ver iaPrecoPorMilTokensExcedenteCentavos):
//   deepseek-v4-flash: US$0,14 entrada (cache miss) / US$0,28 saida
//   deepseek-v4-pro:   US$0,435 entrada (cache miss) / US$0,87 saida

const { ProvedorIA } = require('./ProvedorIA');
const { PROVEDORES_IA, configDaCredencial } = require('../../services/iaPlataforma');

// PROVEDOR (Admin › Integracoes › IA da plataforma): a credencial DEEPSEEK_KEY
// pode dizer { provedor: 'OPENROUTER', modelo: 'org/modelo' } — mesmo formato
// OpenAI, so muda o endereco e o modelo vira um so pra plataforma toda. Ver
// services/iaPlataforma.js. IA_BASE_URL / IA_MODELO_FORCADO (env) passam por
// cima de tudo — so pra teste local. IA_BASE_URL so aceita https.
function baseUrl(env = process.env, dados = null) {
  const v = String(env.IA_BASE_URL || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(v)) return v;
  return PROVEDORES_IA[configDaCredencial(dados).provedor].base;
}

/** Modelo que manda em todos os bots: env IA_MODELO_FORCADO, ou o escolhido pro OpenRouter. */
function modeloForcado(env = process.env, dados = null) {
  const v = String(env.IA_MODELO_FORCADO || '').trim();
  if (/^[a-z0-9._/:-]{1,100}$/i.test(v)) return v;
  return configDaCredencial(dados).modelo;
}

// NOME DO MODELO (nov/2026): o codigo nasceu com "deepseek-v4-flash", mas
// fontes de nov/2026 citam "deepseek-flash" (e "deepseek-v4-pro") — o nome
// do flash pode ter sido aposentado/renomeado. Por isso:
//   - os dois nomes do flash sao aceitos no Bot.iaModelo;
//   - IA_MODELO_PADRAO (env) troca o nome REAL mandado pra API em todo bot
//     da familia flash (e no modelo invalido), sem migrar o banco. Ex.:
//     IA_MODELO_PADRAO=deepseek-flash se a API recusar "deepseek-v4-flash".
//   - pro e respeitado como esta.
const MODELOS_FLASH = new Set(['deepseek-v4-flash', 'deepseek-flash']);
const MODELOS_VALIDOS = new Set([...MODELOS_FLASH, 'deepseek-v4-pro']);
const MODELO_PADRAO = 'deepseek-v4-flash';

/** Nome do modelo padrao: IA_MODELO_PADRAO (se for um nome deepseek valido) ou o fixo. */
function modeloPadrao(env = process.env) {
  const v = String(env.IA_MODELO_PADRAO || '').trim();
  return /^deepseek-[a-z0-9.-]{1,40}$/.test(v) ? v : MODELO_PADRAO;
}

/** Regra pura: qual nome vai pra API. */
function resolverModelo(modelo, env = process.env, dados = null) {
  const forcado = modeloForcado(env, dados);
  if (forcado) return forcado;
  const temEnv = Boolean(String(env.IA_MODELO_PADRAO || '').trim());
  if (MODELOS_FLASH.has(modelo)) return temEnv ? modeloPadrao(env) : modelo;
  if (MODELOS_VALIDOS.has(modelo)) return modelo;
  return modeloPadrao(env);
}

/**
 * Normaliza o payload cru da DeepSeek pro formato que o resto do sistema usa.
 * Funcao pura (sem I/O) de proposito — testavel sem precisar de fixture/rede,
 * so passando um `raw` montado a mao.
 * @param {Object} raw
 * @returns {{texto:string, toolCalls:Array<{id:string,nome:string,argumentos:Object}>, tokensPrompt:number, tokensCompletion:number, tokensTotal:number, bruto:Object}}
 */
function normalizarResposta(raw) {
  const msg = raw?.choices?.[0]?.message || {};
  const usage = raw?.usage || {};

  const toolCalls = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((tc) => {
      let argumentos = {};
      try {
        argumentos = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        argumentos = {}; // argumentos malformados: trata como vazio em vez de derrubar o processo
      }
      return { id: tc.id, nome: tc.function?.name, argumentos };
    })
    : [];

  return {
    texto: msg.content || '',
    toolCalls,
    tokensPrompt: usage.prompt_tokens || 0,
    tokensCompletion: usage.completion_tokens || 0,
    tokensTotal: usage.total_tokens || 0,
    bruto: raw,
  };
}

class DeepSeekAdapter extends ProvedorIA {
  static get provedor() { return 'DEEPSEEK'; }

  get _apiKey() { return this.credencial?.dados?.apiKey; }

  /**
   * @param {{mensagens:Array, modelo?:string, temperatura?:number, maxTokens?:number, tools?:Array}} p
   * `tools` no formato OpenAI: [{ type:'function', function:{ name, description, parameters } }].
   * Omitido/vazio = chat comum, sem ferramentas.
   */
  async responder({ mensagens, modelo, temperatura = 0.7, maxTokens, tools }) {
    if (!Array.isArray(mensagens) || mensagens.length === 0) {
      throw Object.assign(new Error('mensagens nao pode ser vazio.'), { status: 400, codigo: 'IA_SEM_MENSAGENS' });
    }
    const dados = this.credencial?.dados || null;
    const modeloUsado = resolverModelo(modelo, process.env, dados);
    const base = baseUrl(process.env, dados);
    // Clampa pro range documentado (0-2) em vez de deixar a API rejeitar —
    // um valor fora da faixa vindo de configuracao antiga nao deve quebrar o bot.
    const temp = Math.min(2, Math.max(0, Number(temperatura) || 0.7));
    const temFerramentas = Array.isArray(tools) && tools.length > 0;

    const req = {
      url: `${base}/chat/completions`,
      metodo: 'POST',
      headers: {
        Authorization: `Bearer ${this._apiKey}`,
        // OpenRouter identifica o app por esses dois (opcionais, sem efeito na DeepSeek).
        ...(base.includes('openrouter.ai') ? { 'HTTP-Referer': 'https://sellergycloud.com', 'X-Title': 'Sellergy Cloud' } : {}),
      },
      corpo: {
        model: modeloUsado,
        messages: mensagens,
        temperature: temp,
        stream: false,
        ...(Number.isInteger(maxTokens) && maxTokens > 0 ? { max_tokens: maxTokens } : {}),
        ...(temFerramentas ? { tools } : {}),
      },
    };

    const raw = await this._executar(req, () => ({
      id: 'fixture-chatcmpl',
      model: modeloUsado,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Resposta simulada (modo fixture).' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 120 },
    }));

    return normalizarResposta(raw);
  }
}

module.exports = DeepSeekAdapter;
module.exports.MODELOS_VALIDOS = MODELOS_VALIDOS;
module.exports.MODELO_PADRAO = MODELO_PADRAO;
module.exports.MODELOS_FLASH = MODELOS_FLASH;
module.exports.modeloPadrao = modeloPadrao;
module.exports.resolverModelo = resolverModelo;
module.exports.baseUrl = baseUrl;
module.exports.modeloForcado = modeloForcado;
module.exports.normalizarResposta = normalizarResposta;

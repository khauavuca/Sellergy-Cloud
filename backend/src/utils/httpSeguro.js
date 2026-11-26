// Chamada HTTP blindada para provedores externos (PSP, emissor fiscal, IA).
//
// Os adapters faziam fetch() cru, sem timeout nem retentativa: uma rede lenta
// ou uma instabilidade passageira do provedor (429/502/503/504) virava erro
// direto pro cliente final, quando na maioria das vezes uma segunda tentativa
// resolveria. A DeepSeek documenta limite de conexoes simultaneas (429 quando
// excede) e fecha a conexao apos 10min de inatividade sem resposta — mas nao
// prescreve retry, entao a estrategia abaixo e nossa (backoff exponencial,
// poucas tentativas, nunca retenta erro de cliente 4xx que nao seja 429).
//
// Usado pelos 4 pontos que batem em API externa: ProvedorPagamento._executar,
// ProvedorFiscal._executar, whatsappCloud.js e o adapter da DeepSeek — um
// unico lugar pra blindagem, em vez de reimplementar em cada um.

const TIMEOUT_PADRAO_MS = 20_000;
const TENTATIVAS_PADRAO = 3;
const BACKOFF_BASE_MS = 400;

// Status que valem retentativa: 429 (rate limit) e 5xx (instabilidade do
// provedor). Outros 4xx sao erro do proprio request — retentar so repetiria
// a mesma falha.
function vantajosoRetentar(status) {
  return status === 429 || (status >= 500 && status < 600);
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Metodos que podem ser repetidos sem efeito duplicado (RFC 9110 §9.2.2).
const METODOS_IDEMPOTENTES = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

// Cabecalhos de chave de idempotencia aceitos pelos provedores:
// Idempotency-Key (Pagar.me, padrao IETF) e X-Idempotency-Key (Mercado Pago).
const CABECALHOS_IDEMPOTENCIA = ['idempotency-key', 'x-idempotency-key'];

function temChaveIdempotencia(headers) {
  if (!headers) return false;
  if (typeof headers.get === 'function') {
    return CABECALHOS_IDEMPOTENCIA.some((h) => Boolean(headers.get(h)));
  }
  return Object.entries(headers).some(([k, v]) => CABECALHOS_IDEMPOTENCIA.includes(String(k).toLowerCase()) && Boolean(v));
}

/**
 * A chamada pode ser repetida apos 5xx/timeout/erro de rede? So quando o
 * metodo e idempotente, quando leva chave de idempotencia ou quando quem chama
 * forca com `repetirNaoIdempotente: true`. POST/PATCH sem chave NAO repete:
 * um 502/timeout pode ter chegado depois de o provedor criar a cobranca (ou a
 * nota, ou o saque), e repetir duplicaria.
 */
function podeRepetir(opcoes = {}, config = {}) {
  if (config.repetirNaoIdempotente === true) return true;
  const metodo = String(opcoes.method || 'GET').toUpperCase();
  if (METODOS_IDEMPOTENTES.has(metodo)) return true;
  return temChaveIdempotencia(opcoes.headers);
}

/**
 * fetch com timeout (AbortController) e retentativa com backoff exponencial.
 * NAO loga headers/body — quem chama decide o que logar, e nunca deve incluir
 * a credencial no log (isso e responsabilidade do adapter, nao deste utilitario).
 *
 * Metodo nao idempotente (POST/PATCH) sem chave de idempotencia so repete em
 * 429 (o provedor recusou sem processar); 5xx, timeout e erro de rede voltam
 * na primeira falha. Passe `Idempotency-Key`/`X-Idempotency-Key` nos headers
 * ou `repetirNaoIdempotente: true` pra repetir mesmo assim.
 *
 * @param {string} url
 * @param {RequestInit} opcoes
 * @param {{timeoutMs?:number, tentativas?:number, repetirNaoIdempotente?:boolean}} [config]
 * @returns {Promise<Response>}
 */
async function fetchComRetentativa(url, opcoes = {}, config = {}) {
  const timeoutMs = config.timeoutMs || TIMEOUT_PADRAO_MS;
  const tentativas = config.tentativas || TENTATIVAS_PADRAO;
  const seguroRepetir = podeRepetir(opcoes, config);

  let ultimoErro;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...opcoes, signal: controlador.signal });
      clearTimeout(timer);

      const repete = resp.status === 429 || (seguroRepetir && vantajosoRetentar(resp.status));
      if (!resp.ok && repete && tentativa < tentativas) {
        await dormir(BACKOFF_BASE_MS * 2 ** (tentativa - 1));
        continue;
      }
      return resp;
    } catch (erro) {
      clearTimeout(timer);
      ultimoErro = erro?.name === 'AbortError'
        ? Object.assign(new Error(`Tempo esgotado (${timeoutMs}ms) chamando provedor externo.`), { codigo: 'TIMEOUT' })
        : erro;
      if (seguroRepetir && tentativa < tentativas) {
        await dormir(BACKOFF_BASE_MS * 2 ** (tentativa - 1));
        continue;
      }
      throw ultimoErro;
    }
  }
  throw ultimoErro;
}

module.exports = { fetchComRetentativa, vantajosoRetentar, podeRepetir };

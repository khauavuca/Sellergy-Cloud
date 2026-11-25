// Assinatura do webhook do WhatsApp oficial (Meta). A Meta assina o corpo
// CRU de cada POST com HMAC-SHA256 usando o "App Secret" do app e manda em
// `X-Hub-Signature-256: sha256=<hex>`. Sem conferir isso, qualquer um que
// descobrir a URL injeta mensagem falsa em nome de qualquer cliente.
//
// Variaveis de ambiente:
//   WHATSAPP_APP_SECRET               segredo do app na Meta (obrigatorio em producao)
//   WHATSAPP_WEBHOOK_SEM_ASSINATURA=1 so em dev: aceita POST sem assinatura
//                                     quando o segredo nao esta configurado

const crypto = require('crypto');

/**
 * Regra pura: o cabecalho bate com o HMAC do corpo? Compara em tempo constante.
 * @param {{ corpoCru: Buffer|string|undefined, cabecalho: string|undefined, segredo: string }} p
 */
function assinaturaValida({ corpoCru, cabecalho, segredo }) {
  if (!segredo || !cabecalho || corpoCru === undefined || corpoCru === null) return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(String(cabecalho).trim());
  if (!m) return false;
  const esperado = crypto.createHmac('sha256', segredo).update(corpoCru).digest();
  const recebido = Buffer.from(m[1].toLowerCase(), 'hex');
  return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
}

/**
 * Decide se o POST passa.
 * @param {{ corpoCru, cabecalho, env?: NodeJS.ProcessEnv }} p
 * @returns {{ ok: true, modo: 'ASSINADO'|'SEM_ASSINATURA_DEV' } | { ok: false, status: number, motivo: string }}
 */
function conferirWebhookMeta({ corpoCru, cabecalho, env = process.env }) {
  const segredo = env.WHATSAPP_APP_SECRET;
  if (segredo) {
    return assinaturaValida({ corpoCru, cabecalho, segredo })
      ? { ok: true, modo: 'ASSINADO' }
      : { ok: false, status: 401, motivo: 'ASSINATURA_INVALIDA' };
  }
  // Sem segredo configurado: producao recusa sempre; dev so com a chave explicita.
  if (env.NODE_ENV !== 'production' && env.WHATSAPP_WEBHOOK_SEM_ASSINATURA === '1') {
    return { ok: true, modo: 'SEM_ASSINATURA_DEV' };
  }
  return { ok: false, status: 503, motivo: 'SEGREDO_NAO_CONFIGURADO' };
}

module.exports = { assinaturaValida, conferirWebhookMeta };

// Assinatura do webhook do WhatsApp oficial (Meta). A Meta assina o corpo
// CRU de cada POST com HMAC-SHA256 usando o "App Secret" do app e manda em
// `X-Hub-Signature-256: sha256=<hex>`. Sem conferir isso, qualquer um que
// descobrir a URL injeta mensagem falsa em nome de qualquer cliente.
//
// Cada cliente usa o app DELE na Meta, entao cada um tem o seu App Secret,
// guardado na credencial WHATSAPP_CLOUD_TOKEN (campo appSecret). A conferencia
// e feita por numero (phone_number_id): a mensagem de um numero so passa se a
// assinatura bater com o segredo do cliente dono daquele numero. Assim o
// cliente A, que conhece o proprio segredo, nao consegue forjar mensagem
// pro numero do cliente B.
//
// Variaveis de ambiente:
//   WHATSAPP_APP_SECRET               segredo de reserva (app unico/legado),
//                                     usado so quando o cliente nao tem o dele
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

/**
 * Confere a assinatura numero a numero.
 * @param {{ corpoCru, cabecalho, segredosPorNumero: Map<string, string|null>, env?: NodeJS.ProcessEnv }} p
 *   segredosPorNumero: phone_number_id -> appSecret do cliente dono (null se nao tiver).
 * @returns {{ aceitos: Set<string>, recusados: string[], semSegredo: string[], modo: string }}
 */
function conferirWebhookMetaPorNumero({ corpoCru, cabecalho, segredosPorNumero, env = process.env }) {
  const reserva = env.WHATSAPP_APP_SECRET || null;
  const devSemAssinatura = env.NODE_ENV !== 'production' && env.WHATSAPP_WEBHOOK_SEM_ASSINATURA === '1';
  const aceitos = new Set();
  const recusados = [];
  const semSegredo = [];
  let modo = 'ASSINADO';
  for (const [numero, segredoCliente] of segredosPorNumero) {
    const segredo = segredoCliente || reserva;
    if (segredo) {
      if (assinaturaValida({ corpoCru, cabecalho, segredo })) aceitos.add(numero);
      else recusados.push(numero);
    } else if (devSemAssinatura) {
      aceitos.add(numero);
      modo = 'SEM_ASSINATURA_DEV';
    } else {
      semSegredo.push(numero);
    }
  }
  return { aceitos, recusados, semSegredo, modo };
}

module.exports = { assinaturaValida, conferirWebhookMeta, conferirWebhookMetaPorNumero };

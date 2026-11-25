// =====================================================================
// CONEXAO DO WHATSAPP OFICIAL COM O APP DO PROPRIO CLIENTE (Meta)
// =====================================================================
// O cliente cola, num passo so, os 3 dados do app DELE na Meta:
//   - Identificacao do numero de telefone (phone_number_id)
//   - Token de acesso (o permanente, de usuario do sistema)
//   - Segredo do app (App Secret) — confere a assinatura do webhook
// Aqui ficam as regras puras de limpeza/validacao (com mensagens que dizem o
// que fazer, nao so "invalido") e a conferencia na Meta.
// =====================================================================

const crypto = require('crypto');
const { fetchComRetentativa } = require('../utils/httpSeguro');

const GRAPH_VERSAO = process.env.WHATSAPP_GRAPH_VERSAO || 'v21.0';

/** Tira espaco, aspas e quebras de linha que vem junto quando se copia de pagina. */
function limpar(v) {
  return String(v ?? '').replace(/[\s"'`]+/g, '').trim();
}

/**
 * Valida o que o cliente colou. Campos vazios sao aceitos quando `existente`
 * diz que o bot ja tem aquele dado salvo (trocar so o numero, por exemplo).
 * @returns {{ ok: true, dados: { identificadorCanal, accessToken?, appSecret? } } | { ok: false, campo: string, erro: string }}
 */
function validarDadosOficiais(entrada = {}, existente = {}) {
  const dados = {};

  const id = limpar(entrada.identificadorCanal);
  if (!id) return { ok: false, campo: 'identificadorCanal', erro: 'Cole a Identificação do número de telefone (fica em WhatsApp › Configuração da API, na Meta).' };
  if (/^\+|[()-]/.test(String(entrada.identificadorCanal || '').trim()) || (/^\d+$/.test(id) && id.startsWith('55') && id.length <= 13)) {
    return { ok: false, campo: 'identificadorCanal', erro: 'Isso parece o número de telefone. Cole a "Identificação do número de telefone": um código só de dígitos, que fica logo abaixo do número na Meta.' };
  }
  if (!/^\d{10,20}$/.test(id)) {
    return { ok: false, campo: 'identificadorCanal', erro: 'A Identificação do número tem só dígitos (geralmente 15 ou 16). Confira se copiou inteira.' };
  }
  dados.identificadorCanal = id;

  let token = limpar(entrada.accessToken).replace(/^Bearer/i, '');
  if (token) {
    if (token.length < 50 || token.length > 1000 || !/^[A-Za-z0-9_\-.|]+$/.test(token)) {
      return { ok: false, campo: 'accessToken', erro: 'Esse token não parece completo. Copie de novo o token de acesso (começa com "EAA") pelo botão de copiar da Meta.' };
    }
    dados.accessToken = token;
  } else if (!existente.temToken) {
    return { ok: false, campo: 'accessToken', erro: 'Cole o token de acesso do seu app na Meta.' };
  }

  const segredo = limpar(entrada.appSecret);
  if (segredo) {
    if (!/^[A-Za-z0-9]{16,128}$/.test(segredo)) {
      return { ok: false, campo: 'appSecret', erro: 'O segredo do app tem só letras e números (32 caracteres). Na Meta: Configurações do app › Básico › Chave secreta do app › Mostrar.' };
    }
    if (token && segredo === token) {
      return { ok: false, campo: 'appSecret', erro: 'Você colou o token no lugar do segredo do app. O segredo fica em Configurações do app › Básico.' };
    }
    dados.appSecret = segredo;
  } else if (!existente.temSegredo) {
    return { ok: false, campo: 'appSecret', erro: 'Cole o segredo do app. Sem ele o bot não consegue receber as mensagens.' };
  }

  return { ok: true, dados };
}

/** Verify token aleatorio (o cliente so copia e cola na Meta). */
function gerarVerifyToken() {
  return `sellergy-${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Pergunta pra Meta se o token enxerga esse numero. So chama a Meta quando o
 * envio real esta ligado (WHATSAPP_ENVIO_REAL=1); fora disso devolve
 * `simulado: true` (dev e testes nao falam com a Meta).
 * @returns {Promise<{ ok: true, numero?: string, nome?: string, simulado?: true } | { ok: false, motivo: string, erro: string }>}
 */
async function conferirNaMeta({ phoneNumberId, token, env = process.env, fetchFn = fetchComRetentativa }) {
  if (env.WHATSAPP_ENVIO_REAL !== '1') return { ok: true, simulado: true };
  let resposta;
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSAO}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`;
    resposta = await fetchFn(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 10000, tentativas: 2 });
  } catch {
    return { ok: false, motivo: 'SEM_RESPOSTA', erro: 'A Meta não respondeu agora. Tente de novo em alguns minutos.' };
  }
  let corpo = null;
  try { corpo = await resposta.json(); } catch { corpo = null; }
  if (resposta.ok && corpo?.display_phone_number) {
    return { ok: true, numero: corpo.display_phone_number, nome: corpo.verified_name || null };
  }
  const codigo = corpo?.error?.code;
  if (codigo === 190) {
    return { ok: false, motivo: 'TOKEN_INVALIDO', erro: 'A Meta recusou o token (vencido ou errado). Use o token permanente do usuário do sistema, que não vence em 24 horas.' };
  }
  if (codigo === 100 || codigo === 803 || resposta.status === 404) {
    return { ok: false, motivo: 'NUMERO_NAO_ENCONTRADO', erro: 'A Meta não achou esse número com esse token. Confira a Identificação do número e se o token é do mesmo app.' };
  }
  if (codigo === 10 || codigo === 200) {
    return { ok: false, motivo: 'SEM_PERMISSAO', erro: 'O token não tem permissão de WhatsApp. Ao gerar, marque whatsapp_business_messaging e whatsapp_business_management.' };
  }
  return { ok: false, motivo: 'ERRO_META', erro: 'A Meta não aceitou esses dados. Confira o número, o token e tente de novo.' };
}

module.exports = { validarDadosOficiais, gerarVerifyToken, conferirNaMeta, limpar };

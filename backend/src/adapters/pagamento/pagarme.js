// Adapter Pagar.me (Core API v5) — implementa ProvedorPagamento.
// Auth: Basic <base64(secretKey:)> (chave secreta como usuário, senha vazia).
// Base: https://api.pagar.me/core/v5. Pix: POST /orders (payments[].payment_method='pix').
// Webhook: { type:'charge.paid'|..., data:{...} } + assinatura X-Hub-Signature
// (sha256=<HMAC>) com o segredo do endpoint.
// Link de pagamento: a Cobranca guarda o id do LINK, mas o webhook charge.*
// traz o id da CHARGE. O `code` (= id da Cobranca, enviado como refExterna)
// volta no pedido/charge e liga o evento de volta (ver webhooks.routes.js).
// POST leva Idempotency-Key (= id da Cobranca): retentativa nao duplica.

const crypto = require('crypto');
const { ProvedorPagamento, STATUS } = require('./ProvedorPagamento');

const BASE = 'https://api.pagar.me/core/v5';

function normalizarStatus(s) {
  switch (s) {
    case 'paid':
    case 'partial_paid': return STATUS.PAGO;
    case 'pending':
    case 'processing':
    case 'waiting_payment': return STATUS.PENDENTE;
    case 'canceled':
    case 'failed': return STATUS.CANCELADO;
    case 'refunded':
    case 'chargedback': return STATUS.ESTORNADO;
    case 'expired': return STATUS.EXPIRADO;
    default: return STATUS.PENDENTE;
  }
}

// charge.* / order.* → status normalizado
function statusDoEvento(tipo, dataStatus) {
  if (tipo === 'charge.paid' || tipo === 'order.paid') return STATUS.PAGO;
  if (tipo === 'charge.refunded') return STATUS.ESTORNADO;
  if (tipo === 'charge.payment_failed') return STATUS.CANCELADO;
  return normalizarStatus(dataStatus);
}

// code do pedido (= refExterna) numa charge/evento: no proprio objeto, no
// pedido ou em metadata.
function referenciaDe(d) {
  const ref = d?.order?.code || d?.code || d?.metadata?.code || d?.order?.metadata?.code;
  return ref ? String(ref) : undefined;
}

class PagarmeAdapter extends ProvedorPagamento {
  static get provedor() { return 'PAGARME'; }

  get _secretKey() { return this.credencial?.dados?.secretKey || this.credencial?.dados?.apiKey; }
  _headers(idempotencyKey) {
    const b64 = Buffer.from(`${this._secretKey}:`, 'utf8').toString('base64');
    const h = { Authorization: `Basic ${b64}` };
    if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
    return h;
  }

  async criarCobrancaPix({ valor, descricao, refExterna, pagador }) {
    const centavos = Math.round(Number(valor) * 100);
    const req = {
      url: `${BASE}/orders`,
      metodo: 'POST',
      headers: this._headers(`pix-${refExterna}`),
      corpo: {
        code: refExterna,
        items: [{ amount: centavos, description: descricao, quantity: 1 }],
        customer: { name: pagador?.nome || 'Cliente', email: pagador?.email || 'sem-email@sellergy.app' },
        payments: [{ payment_method: 'pix', pix: { expires_in: 86_400 } }],
      },
    };
    const raw = await this._executar(req, () => ({
      id: `or_${refExterna}`,
      status: 'pending',
      charges: [{
        id: `ch_${refExterna}`,
        status: 'pending',
        last_transaction: {
          qr_code: '00020126fixtureEMVpixpagarme5204000053039865802BR6304PQRS',
          qr_code_url: `https://api.pagar.me/qr/${refExterna}.png`,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      }],
    }));
    const charge = raw.charges?.[0] || {};
    const tx = charge.last_transaction || {};
    return {
      // chaveamos pela CHARGE (é o que o webhook charge.* referencia)
      provedorCobrancaId: String(charge.id || raw.id),
      status: normalizarStatus(charge.status || raw.status),
      qrCode: tx.qr_code,
      linkUrl: tx.qr_code_url,
      vencimento: tx.expires_at,
      bruto: raw,
    };
  }

  async criarLink({ valor, descricao, refExterna }) {
    const centavos = Math.round(Number(valor) * 100);
    const req = {
      url: `${BASE}/paymentlinks`,
      metodo: 'POST',
      headers: this._headers(`link-${refExterna}`),
      corpo: {
        name: descricao,
        type: 'order',
        payment_settings: { accepted_payment_methods: ['pix', 'credit_card'] },
        cart_settings: { items: [{ amount: centavos, name: descricao, default_quantity: 1 }] },
        code: refExterna,
      },
    };
    const raw = await this._executar(req, () => ({
      id: `link_${refExterna}`,
      status: 'active',
      url: `https://payment-link.pagar.me/${refExterna}`,
    }));
    return {
      provedorCobrancaId: String(raw.id),
      status: STATUS.PENDENTE,
      linkUrl: raw.url,
      bruto: raw,
    };
  }

  /**
   * Consulta uma CHARGE pelo id. `refExterna` = code do pedido/charge (id da
   * Cobranca), pra quem casou o webhook pela referencia conferir.
   * @param {string} id  id da charge
   * @param {{refExterna?:string}} [opts]  so pro fixture ecoar a referencia
   */
  async consultarStatus(id, { refExterna } = {}) {
    const req = { url: `${BASE}/charges/${encodeURIComponent(id)}`, headers: this._headers() };
    const raw = await this._executar(req, () => ({ id, status: 'paid', paid_at: new Date().toISOString(), code: refExterna }));
    return { status: normalizarStatus(raw.status), pagoEm: raw.paid_at || undefined, refExterna: referenciaDe(raw) };
  }

  async estornar(provedorCobrancaId) {
    const req = { url: `${BASE}/charges/${provedorCobrancaId}`, metodo: 'DELETE', headers: this._headers() };
    await this._executar(req, () => ({ id: provedorCobrancaId, status: 'refunded' }));
    return { status: STATUS.ESTORNADO };
  }

  // X-Hub-Signature: "sha256=<hmac hex>" sobre o corpo cru.
  verificarAssinatura({ headers, rawBody, segredo }) {
    const sig = headers['x-hub-signature'] || headers['X-Hub-Signature'];
    if (!sig || !segredo || !rawBody) return false;
    const recebido = String(sig).replace(/^sha256=/, '');
    const corpo = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const esperado = crypto.createHmac('sha256', segredo).update(corpo).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
    } catch { return false; }
  }

  parsearWebhook({ body }) {
    if (!body || !body.type || !body.data) return null;
    const d = body.data;
    const id = d.id; // charge id (eventos charge.*); order id (order.*)
    if (!id) return null;
    // order.*: a consulta e por charge — usa a 1a charge do pedido.
    const chargeId = String(body.type).startsWith('order.') ? (d.charges?.[0]?.id || id) : id;
    return {
      provedorCobrancaId: String(id),
      pagamentoId: String(chargeId),
      refExterna: referenciaDe(d),
      status: statusDoEvento(body.type, d.status),
      pagoEm: d.paid_at || undefined,
      evento: body.type,
    };
  }
}

module.exports = PagarmeAdapter;

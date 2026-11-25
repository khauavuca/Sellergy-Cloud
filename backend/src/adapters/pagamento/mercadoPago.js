// Adapter Mercado Pago — implementa ProvedorPagamento.
// Auth: Bearer access_token. Base: https://api.mercadopago.com
// Docs: /v1/payments (Pix), /checkout/preferences (link), /v1/payments/{id}/refunds.
// Webhook: { type:'payment', data:{ id } } + assinatura x-signature (ts,v1=HMAC).
// O `data.id` do webhook e sempre o id do PAYMENT. No Pix ele e o mesmo id
// gravado na Cobranca; no link (preference) nao — por isso a notification_url
// leva `?ref=<id da Cobranca>` e o external_reference do payment consultado
// confirma o casamento (ver webhooks.routes.js).

const crypto = require('crypto');
const { ProvedorPagamento, STATUS } = require('./ProvedorPagamento');

const BASE = 'https://api.mercadopago.com';

function urlNotificacao(refExterna) {
  const base = String(process.env.API_URL_PUBLICA || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) return undefined;
  const url = `${base}/webhooks/pagamento/mercado_pago`;
  return refExterna ? `${url}?ref=${encodeURIComponent(refExterna)}` : url;
}

// status do MP → status normalizado
function normalizarStatus(s) {
  switch (s) {
    case 'approved': return STATUS.PAGO;
    case 'authorized': return STATUS.PAGO;
    case 'pending':
    case 'in_process':
    case 'in_mediation': return STATUS.PENDENTE;
    case 'cancelled': return STATUS.CANCELADO;
    case 'rejected': return STATUS.CANCELADO;
    case 'refunded':
    case 'charged_back': return STATUS.ESTORNADO;
    default: return STATUS.PENDENTE;
  }
}

class MercadoPagoAdapter extends ProvedorPagamento {
  static get provedor() { return 'MERCADO_PAGO'; }

  get _token() { return this.credencial?.dados?.accessToken || this.credencial?.dados?.token; }

  _headers(idempotencyKey) {
    const h = { Authorization: `Bearer ${this._token}` };
    if (idempotencyKey) h['X-Idempotency-Key'] = idempotencyKey;
    return h;
  }

  async criarCobrancaPix({ valor, descricao, refExterna, pagador }) {
    const req = {
      url: `${BASE}/v1/payments`,
      metodo: 'POST',
      headers: this._headers(`pix-${refExterna}`),
      corpo: {
        transaction_amount: Number(valor),
        description: descricao,
        payment_method_id: 'pix',
        external_reference: refExterna,
        payer: { email: pagador?.email || 'sem-email@sellergy.app', first_name: pagador?.nome || undefined },
        // Com a URL publica da API configurada, o MP avisa direto a rota de
        // webhook (sem depender de cadastro manual no painel do MP).
        notification_url: urlNotificacao(refExterna),
      },
    };
    const raw = await this._executar(req, () => ({
      id: `mp_pix_${refExterna}`,
      status: 'pending',
      date_of_expiration: new Date(Date.now() + 86_400_000).toISOString(),
      point_of_interaction: {
        transaction_data: {
          qr_code: '00020126fixtureEMVpixmercadopago5204000053039865802BR6304ABCD',
          qr_code_base64: 'iVBORw0KGgoFIXTUREbase64==',
          ticket_url: `https://www.mercadopago.com/payments/${refExterna}/ticket`,
        },
      },
    }));
    const td = raw.point_of_interaction?.transaction_data || {};
    return {
      provedorCobrancaId: String(raw.id),
      status: normalizarStatus(raw.status),
      qrCode: td.qr_code,
      qrCodeBase64: td.qr_code_base64,
      linkUrl: td.ticket_url,
      vencimento: raw.date_of_expiration,
      bruto: raw,
    };
  }

  async criarLink({ valor, descricao, refExterna }) {
    const req = {
      url: `${BASE}/checkout/preferences`,
      metodo: 'POST',
      headers: this._headers(),
      corpo: {
        items: [{ title: descricao, quantity: 1, unit_price: Number(valor), currency_id: 'BRL' }],
        external_reference: refExterna,
        // O payment do link nasce com outro id: o ?ref= e o external_reference
        // ligam o webhook de volta a esta Cobranca.
        notification_url: urlNotificacao(refExterna),
      },
    };
    const raw = await this._executar(req, () => ({
      id: `mp_pref_${refExterna}`,
      init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=mp_pref_${refExterna}`,
    }));
    return {
      provedorCobrancaId: String(raw.id),
      status: STATUS.PENDENTE,
      linkUrl: raw.init_point,
      bruto: raw,
    };
  }

  /**
   * Consulta um PAYMENT pelo id. `refExterna` volta o external_reference (id
   * da Cobranca) pra quem casou o webhook pela referencia conferir.
   * @param {string} id  id do payment
   * @param {{refExterna?:string}} [opts]  so pro fixture ecoar a referencia
   */
  async consultarStatus(id, { refExterna } = {}) {
    const req = { url: `${BASE}/v1/payments/${encodeURIComponent(id)}`, headers: this._headers() };
    const raw = await this._executar(req, () => ({ id, status: 'approved', date_approved: new Date().toISOString(), external_reference: refExterna }));
    return {
      status: normalizarStatus(raw.status),
      pagoEm: raw.date_approved || undefined,
      refExterna: raw.external_reference ? String(raw.external_reference) : undefined,
    };
  }

  async estornar(provedorCobrancaId) {
    const req = { url: `${BASE}/v1/payments/${provedorCobrancaId}/refunds`, metodo: 'POST', headers: this._headers(`refund-${provedorCobrancaId}`) };
    await this._executar(req, () => ({ id: `refund_${provedorCobrancaId}`, status: 'approved' }));
    return { status: STATUS.ESTORNADO };
  }

  /**
   * x-signature: "ts=<unix>,v1=<hmac>". Manifest (doc do MP):
   *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
   * O `data.id` vem na QUERY STRING da notificacao (?data.id=...&type=payment),
   * nao nos headers; id alfanumerico vai em minusculas. Parte ausente sai do
   * manifest.
   * @param {{headers:Object, segredo:string, query?:Object, body?:Object}} p
   */
  verificarAssinatura({ headers = {}, segredo, query = {}, body } = {}) {
    const sig = headers['x-signature'] || headers['X-Signature'];
    if (!sig || !segredo) return false;
    const partes = {};
    for (const p of String(sig).split(',')) {
      const i = p.indexOf('=');
      if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    }
    const { ts, v1 } = partes;
    if (!ts || !v1) return false;
    const dataIdBruto = query?.['data.id'] ?? query?.data?.id ?? query?.id ?? body?.data?.id ?? '';
    const dataId = String(dataIdBruto).toLowerCase();
    const requestId = headers['x-request-id'] || headers['X-Request-Id'] || '';
    let manifest = '';
    if (dataId) manifest += `id:${dataId};`;
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${ts};`;
    const esperado = crypto.createHmac('sha256', segredo).update(manifest).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(String(v1)));
    } catch { return false; }
  }

  parsearWebhook({ body, query = {} } = {}) {
    const tipo = body?.type || query?.type || query?.topic;
    if (tipo !== 'payment') return null;
    const id = body?.data?.id ?? query?.['data.id'] ?? query?.id;
    if (!id) return null;
    const ref = typeof query?.ref === 'string' && query.ref ? query.ref : undefined;
    // O webhook do MP traz so o id do payment — o status definitivo (e o
    // external_reference que confirma a Cobranca) vem de consultarStatus().
    return {
      provedorCobrancaId: String(id),
      pagamentoId: String(id),
      refExterna: ref,
      status: STATUS.PENDENTE,
      evento: body?.action || tipo,
    };
  }
}

module.exports = MercadoPagoAdapter;

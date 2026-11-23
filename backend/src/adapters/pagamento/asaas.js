// Adapter Asaas — implementa ProvedorPagamento.
// Auth: header `access_token: <apiKey>`. Base prod: https://api.asaas.com/v3
// (sandbox: https://api-sandbox.asaas.com/v3).
// Toda cobranca do Asaas precisa de um customer: com `pagador.cpfCnpj` o
// adapter cria o customer antes.
// Fluxo Pix: POST /payments (billingType PIX) → GET /payments/{id}/pixQrCode.
// Webhook: { event:'PAYMENT_RECEIVED'|..., payment:{...} } + token próprio no
// header `asaas-access-token` (definido ao cadastrar o webhook).

const crypto = require('crypto');
const { ProvedorPagamento, STATUS } = require('./ProvedorPagamento');

const BASE_PROD = 'https://api.asaas.com/v3';
const BASE_SANDBOX = 'https://api-sandbox.asaas.com/v3';

function normalizarStatus(s) {
  switch (s) {
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH': return STATUS.PAGO;
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS': return STATUS.PENDENTE;
    case 'OVERDUE': return STATUS.EXPIRADO;
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'CHARGEBACK_REQUESTED': return STATUS.ESTORNADO;
    case 'DELETED':
    case 'CANCELED': return STATUS.CANCELADO;
    default: return STATUS.PENDENTE;
  }
}

// event do webhook Asaas → status normalizado
function statusDoEvento(ev) {
  if (ev === 'PAYMENT_RECEIVED' || ev === 'PAYMENT_CONFIRMED') return STATUS.PAGO;
  if (ev === 'PAYMENT_REFUNDED') return STATUS.ESTORNADO;
  if (ev === 'PAYMENT_OVERDUE') return STATUS.EXPIRADO;
  if (ev === 'PAYMENT_DELETED') return STATUS.CANCELADO;
  return STATUS.PENDENTE;
}

class AsaasAdapter extends ProvedorPagamento {
  static get provedor() { return 'ASAAS'; }

  get _base() { return this.ambiente === 'producao' ? BASE_PROD : BASE_SANDBOX; }
  get _apiKey() { return this.credencial?.dados?.apiKey || this.credencial?.dados?.accessToken; }
  _headers() { return { access_token: this._apiKey }; }

  _vencimentoPadrao() { return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10); }

  /**
   * Resolve o customer do Asaas de quem paga. Aceita um id pronto
   * (`pagador.clienteExternoId`, ou o legado `pagador.documento` com cara de
   * "cus_..."); com CPF/CNPJ, cria o customer. Sem nada disso, em modo live o
   * Asaas recusaria a cobranca — falha antes, com mensagem clara.
   */
  async _customer(pagador, refExterna) {
    const idPronto = pagador?.clienteExternoId
      || (typeof pagador?.documento === 'string' && pagador.documento.startsWith('cus_') ? pagador.documento : null);
    if (idPronto) return idPronto;
    const doc = String(pagador?.cpfCnpj || '').replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) {
      if (this.modo === 'fixture') return 'cus_fixture';
      throw Object.assign(new Error('O Asaas pede o CPF de quem vai pagar.'), { status: 422, codigo: 'PAGADOR_SEM_CPF' });
    }
    const req = {
      url: `${this._base}/customers`,
      metodo: 'POST',
      headers: this._headers(),
      corpo: {
        name: String(pagador?.nome || 'Cliente').slice(0, 100),
        cpfCnpj: doc,
        mobilePhone: String(pagador?.telefone || '').replace(/\D/g, '').slice(-11) || undefined,
        email: pagador?.email || undefined,
        externalReference: refExterna,
        notificationDisabled: true, // o aviso sai pelo WhatsApp do negocio
      },
    };
    const c = await this._executar(req, () => ({ id: `cus_${doc}` }));
    return String(c.id);
  }

  async criarCobrancaPix({ valor, descricao, refExterna, vencimento, pagador }) {
    const customer = await this._customer(pagador, refExterna);
    const reqPg = {
      url: `${this._base}/payments`,
      metodo: 'POST',
      headers: this._headers(),
      corpo: {
        customer,
        billingType: 'PIX',
        value: Number(valor),
        dueDate: (vencimento || '').slice(0, 10) || this._vencimentoPadrao(),
        description: descricao,
        externalReference: refExterna,
      },
    };
    const pg = await this._executar(reqPg, () => ({
      id: `pay_${refExterna}`,
      status: 'PENDING',
      dueDate: reqPg.corpo.dueDate,
      invoiceUrl: `https://sandbox.asaas.com/i/${refExterna}`,
    }));

    const reqQr = { url: `${this._base}/payments/${pg.id}/pixQrCode`, headers: this._headers() };
    const qr = await this._executar(reqQr, () => ({
      encodedImage: 'iVBORw0KGgoFIXTUREasaasQR==',
      payload: '00020126fixtureEMVpixasaas5204000053039865802BR6304WXYZ',
      expirationDate: new Date(Date.now() + 86_400_000).toISOString(),
    }));

    return {
      provedorCobrancaId: String(pg.id),
      status: normalizarStatus(pg.status),
      qrCode: qr.payload,
      qrCodeBase64: qr.encodedImage,
      linkUrl: pg.invoiceUrl,
      vencimento: qr.expirationDate || pg.dueDate,
      bruto: { pg, qr },
    };
  }

  async criarLink({ valor, descricao, refExterna, vencimento, pagador }) {
    const customer = await this._customer(pagador, refExterna);
    const req = {
      url: `${this._base}/payments`,
      metodo: 'POST',
      headers: this._headers(),
      corpo: {
        customer,
        billingType: 'UNDEFINED', // deixa o pagador escolher (Pix/boleto/cartão)
        value: Number(valor),
        dueDate: (vencimento || '').slice(0, 10) || this._vencimentoPadrao(),
        description: descricao,
        externalReference: refExterna,
      },
    };
    const pg = await this._executar(req, () => ({
      id: `pay_${refExterna}`,
      status: 'PENDING',
      invoiceUrl: `https://sandbox.asaas.com/i/${refExterna}`,
      dueDate: req.corpo.dueDate,
    }));
    return {
      provedorCobrancaId: String(pg.id),
      status: normalizarStatus(pg.status),
      linkUrl: pg.invoiceUrl,
      vencimento: pg.dueDate,
      bruto: pg,
    };
  }

  async consultarStatus(provedorCobrancaId) {
    const req = { url: `${this._base}/payments/${provedorCobrancaId}`, headers: this._headers() };
    const raw = await this._executar(req, () => ({ id: provedorCobrancaId, status: 'RECEIVED', paymentDate: new Date().toISOString().slice(0, 10) }));
    return { status: normalizarStatus(raw.status), pagoEm: raw.paymentDate || undefined };
  }

  async estornar(provedorCobrancaId) {
    const req = { url: `${this._base}/payments/${provedorCobrancaId}/refund`, metodo: 'POST', headers: this._headers() };
    await this._executar(req, () => ({ id: provedorCobrancaId, status: 'REFUNDED' }));
    return { status: STATUS.ESTORNADO };
  }

  // Asaas autentica o webhook por um token fixo que você cadastra (não HMAC).
  verificarAssinatura({ headers, segredo }) {
    if (!segredo) return false;
    const token = headers['asaas-access-token'] || headers['Asaas-Access-Token'];
    if (!token) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(String(token)), Buffer.from(String(segredo)));
    } catch { return false; }
  }

  parsearWebhook({ body }) {
    if (!body || !body.event || !body.payment) return null;
    const p = body.payment;
    return {
      provedorCobrancaId: String(p.id),
      status: statusDoEvento(body.event),
      pagoEm: p.paymentDate || p.confirmedDate || undefined,
      evento: body.event,
    };
  }
}

module.exports = AsaasAdapter;

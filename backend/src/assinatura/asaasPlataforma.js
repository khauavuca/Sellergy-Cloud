// =====================================================================
// ASAAS DA PLATAFORMA — cobra a mensalidade do Sellergy dos clientes.
// =====================================================================
// Nao confundir com adapters/pagamento/asaas.js, que usa a conta Asaas do
// TENANT pra cobrar o cliente final dele. Aqui a conta e a do Sellergy.
//
// Por que Asaas: assinatura recorrente nativa (Pix, boleto e cartao), pagina
// de pagamento hospedada por eles (o numero do cartao nunca passa pelo nosso
// servidor: fora do escopo PCI) e custo por transacao, sem mensalidade.
//
// Variaveis:
//   ASAAS_PLATAFORMA_API_KEY        chave da conta Asaas do Sellergy
//   ASAAS_PLATAFORMA_AMBIENTE       sandbox | producao   (padrao: sandbox)
//   ASAAS_PLATAFORMA_WEBHOOK_TOKEN  token que o Asaas manda no webhook
// Sem a chave, tudo aqui fica desligado e a cobranca volta ao modo manual
// (faturas locais + baixa pelo admin).
// =====================================================================

const { fetchComRetentativa } = require('../utils/httpSeguro');

const BASE = {
  producao: 'https://api.asaas.com/v3',
  sandbox: 'https://api-sandbox.asaas.com/v3',
};

const CICLO_ASAAS = { MENSAL: 'MONTHLY', ANUAL: 'YEARLY' };
const FORMAS = new Set(['PIX', 'CREDIT_CARD', 'BOLETO', 'UNDEFINED']);

function ativo() {
  return Boolean(process.env.ASAAS_PLATAFORMA_API_KEY);
}

function baseUrl() {
  return process.env.ASAAS_PLATAFORMA_AMBIENTE === 'producao' ? BASE.producao : BASE.sandbox;
}

class ErroAsaas extends Error {
  constructor(mensagem, status, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
    this.codigo = 'ASAAS_PLATAFORMA';
  }
}

async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
  if (!ativo()) throw new ErroAsaas('Cobranca automatica desligada (ASAAS_PLATAFORMA_API_KEY vazia).', 503);
  const resp = await fetchComRetentativa(`${baseUrl()}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'sellergy-cloud',
      access_token: process.env.ASAAS_PLATAFORMA_API_KEY,
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  }, { timeoutMs: 15_000 });
  const texto = await resp.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = null; }
  if (!resp.ok) {
    // Nunca loga a chave; so a mensagem que o Asaas devolveu.
    const msg = json?.errors?.map((e) => e.description).join(' ') || `Asaas respondeu ${resp.status}`;
    throw new ErroAsaas(msg, resp.status, json?.errors || null);
  }
  return json;
}

function soDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

/** Cria (ou reaproveita) o cliente do Sellergy dentro do Asaas. */
async function criarCustomer({ nome, cpfCnpj, email, telefone, referencia }) {
  const corpo = {
    name: nome,
    cpfCnpj: soDigitos(cpfCnpj),
    email: email || undefined,
    mobilePhone: soDigitos(telefone) || undefined,
    externalReference: referencia,
    // O Asaas tambem manda e-mail de cobranca; o WhatsApp sai da nossa regua.
    notificationDisabled: false,
  };
  const r = await chamar('/customers', { metodo: 'POST', corpo });
  return r.id;
}

async function atualizarCustomer(customerId, { nome, cpfCnpj, email, telefone }) {
  await chamar(`/customers/${customerId}`, {
    metodo: 'POST',
    corpo: { name: nome, cpfCnpj: soDigitos(cpfCnpj), email: email || undefined, mobilePhone: soDigitos(telefone) || undefined },
  });
}

/**
 * Cria a assinatura recorrente. O Asaas gera cada cobranca sozinho e avisa
 * pelo webhook (PAYMENT_CREATED, PAYMENT_RECEIVED, PAYMENT_OVERDUE...).
 */
async function criarAssinatura({ customerId, valor, ciclo, forma, primeiroVencimento, descricao, referencia }) {
  if (!FORMAS.has(forma)) throw new ErroAsaas('Forma de pagamento invalida.', 422);
  const r = await chamar('/subscriptions', {
    metodo: 'POST',
    corpo: {
      customer: customerId,
      billingType: forma,
      value: Number(valor),
      nextDueDate: dataIso(primeiroVencimento),
      cycle: CICLO_ASAAS[ciclo] || 'MONTHLY',
      description: descricao,
      externalReference: referencia,
    },
  });
  return r.id;
}

/** Troca de plano/ciclo/forma. updatePendingPayments ajusta a cobranca em aberto. */
async function atualizarAssinatura(assinaturaId, { valor, ciclo, forma, descricao }) {
  const corpo = { updatePendingPayments: true };
  if (valor !== undefined) corpo.value = Number(valor);
  if (ciclo) corpo.cycle = CICLO_ASAAS[ciclo];
  if (forma) corpo.billingType = forma;
  if (descricao) corpo.description = descricao;
  await chamar(`/subscriptions/${assinaturaId}`, { metodo: 'POST', corpo });
}

async function cancelarAssinatura(assinaturaId) {
  await chamar(`/subscriptions/${assinaturaId}`, { metodo: 'DELETE' });
}

/** Cobrancas da assinatura (a mais proxima primeiro). */
async function cobrancasDaAssinatura(assinaturaId) {
  const r = await chamar(`/subscriptions/${assinaturaId}/payments?limit=10`);
  return (r?.data || []).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
}

async function obterCobranca(pagamentoId) {
  return chamar(`/payments/${pagamentoId}`);
}

function dataIso(d) {
  const x = new Date(d);
  // Data no fuso do processo (TZ=America/Sao_Paulo na imagem), sem hora.
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

module.exports = {
  ativo,
  criarCustomer,
  atualizarCustomer,
  criarAssinatura,
  atualizarAssinatura,
  cancelarAssinatura,
  cobrancasDaAssinatura,
  obterCobranca,
  dataIso,
  ErroAsaas,
  FORMAS,
};

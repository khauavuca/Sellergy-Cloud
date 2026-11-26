// =====================================================================
// SUBCONTA ASAAS — conta de recebimento do tenant aberta pela PLATAFORMA.
// =====================================================================
// A conta Asaas do Sellergy (ASAAS_PLATAFORMA_API_KEY) cria uma subconta
// (POST /accounts) com os dados do negocio. O Asaas devolve a apiKey da
// subconta: ela vai cifrada pro cofre do tenant (credencial ASAAS_KEY) e
// nunca sai pro navegador. Dali pra frente, tudo da subconta (status,
// saldo, extrato, taxas, saque) e chamado com a chave DELA.
//
// Este arquivo tem:
//   - as regras puras (validar dados do assistente, montar o payload,
//     traduzir status) — testadas em subcontaAsaas.test.js;
//   - o cliente HTTP (mesmo padrao de assinatura/asaasPlataforma.js).
//
// Variaveis: as mesmas da cobranca da mensalidade (ASAAS_PLATAFORMA_API_KEY,
// ASAAS_PLATAFORMA_AMBIENTE, ASAAS_PLATAFORMA_WEBHOOK_TOKEN) + API_URL_PUBLICA
// pros webhooks da subconta. ASAAS_PLATAFORMA_BASE_URL troca a URL base
// (so pra teste com o Asaas simulado).
// =====================================================================

const { fetchComRetentativa } = require('../utils/httpSeguro');
const { validarCnpj, validarCpf } = require('../utils/validacaoFiscal');

const BASE = {
  producao: 'https://api.asaas.com/v3',
  sandbox: 'https://api-sandbox.asaas.com/v3',
};

const TIPOS_EMPRESA = ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'];
const TIPOS_CHAVE_PIX = ['CNPJ', 'CPF', 'EMAIL', 'PHONE', 'EVP'];
const PRAZOS = ['PADRAO', 'ANTECIPADO'];

const EVENTOS_PAGAMENTO = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED'];
const EVENTOS_CONTA = [
  'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL',
];

function ativa(env = process.env) {
  return Boolean(env.ASAAS_PLATAFORMA_API_KEY);
}

/** 'producao' | 'sandbox' — o mesmo ambiente da conta da plataforma. */
function ambiente(env = process.env) {
  return env.ASAAS_PLATAFORMA_AMBIENTE === 'producao' ? 'producao' : 'sandbox';
}

function baseUrl(env = process.env) {
  const override = String(env.ASAAS_PLATAFORMA_BASE_URL || '').replace(/\/$/, '');
  return override || BASE[ambiente(env)];
}

class ErroSubconta extends Error {
  constructor(mensagem, status = 502, { campos, detalhes, codigo = 'ASAAS_SUBCONTA' } = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    if (campos) this.campos = campos;
    if (detalhes) this.detalhes = detalhes;
  }
}

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// ---------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------

function idade(dataIso, agora = new Date()) {
  const d = new Date(`${dataIso}T12:00:00`);
  let anos = agora.getFullYear() - d.getFullYear();
  const m = agora.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && agora.getDate() < d.getDate())) anos -= 1;
  return anos;
}

/**
 * Valida e normaliza os 3 passos do assistente. Lanca ErroSubconta 422 com
 * `campos` (nomes "passo.campo") quando algo esta errado.
 * @param {{negocio:Object, responsavel:Object, repasse:Object}} entrada
 */
function validarDadosSubconta(entrada, agora = new Date()) {
  const n = entrada?.negocio || {};
  const r = entrada?.responsavel || {};
  const p = entrada?.repasse || {};
  const campos = [];

  const negocio = {
    cnpj: soDigitos(n.cnpj),
    razaoSocial: texto(n.razaoSocial, 120),
    nomeFantasia: texto(n.nomeFantasia, 80) || null,
    tipoEmpresa: String(n.tipoEmpresa || '').toUpperCase(),
    email: texto(n.email, 120).toLowerCase(),
    telefone: soDigitos(n.telefone),
    faturamentoMensal: Number(n.faturamentoMensal),
    cep: soDigitos(n.cep),
    endereco: texto(n.endereco, 120),
    numero: texto(n.numero, 20),
    complemento: texto(n.complemento, 60) || null,
    bairro: texto(n.bairro, 60),
  };
  if (!validarCnpj(negocio.cnpj)) campos.push('negocio.cnpj');
  if (negocio.razaoSocial.length < 3) campos.push('negocio.razaoSocial');
  if (!TIPOS_EMPRESA.includes(negocio.tipoEmpresa)) campos.push('negocio.tipoEmpresa');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(negocio.email)) campos.push('negocio.email');
  if (negocio.telefone.length < 10 || negocio.telefone.length > 11) campos.push('negocio.telefone');
  if (!Number.isFinite(negocio.faturamentoMensal) || negocio.faturamentoMensal <= 0 || negocio.faturamentoMensal > 100_000_000) campos.push('negocio.faturamentoMensal');
  if (negocio.cep.length !== 8) campos.push('negocio.cep');
  if (negocio.endereco.length < 3) campos.push('negocio.endereco');
  if (!negocio.numero) campos.push('negocio.numero');
  if (negocio.bairro.length < 2) campos.push('negocio.bairro');

  const responsavel = {
    nome: texto(r.nome, 100),
    cpf: soDigitos(r.cpf),
    dataNascimento: typeof r.dataNascimento === 'string' ? r.dataNascimento.slice(0, 10) : '',
    celular: soDigitos(r.celular) || negocio.telefone,
  };
  if (responsavel.nome.split(' ').length < 2) campos.push('responsavel.nome');
  if (!validarCpf(responsavel.cpf)) campos.push('responsavel.cpf');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(responsavel.dataNascimento) || Number.isNaN(new Date(responsavel.dataNascimento).getTime())
    || idade(responsavel.dataNascimento, agora) < 18 || idade(responsavel.dataNascimento, agora) > 110) {
    campos.push('responsavel.dataNascimento');
  }
  if (responsavel.celular.length < 10 || responsavel.celular.length > 11) campos.push('responsavel.celular');

  const repasse = {
    prazo: PRAZOS.includes(p.prazo) ? p.prazo : null,
    tipoChavePix: String(p.tipoChavePix || '').toUpperCase(),
    chavePix: normalizarChavePix(p.tipoChavePix, p.chavePix),
  };
  if (!repasse.prazo) campos.push('repasse.prazo');
  const motivoChave = validarChavePix(repasse.tipoChavePix, repasse.chavePix, { cnpj: negocio.cnpj });
  if (motivoChave) campos.push('repasse.chavePix');

  if (campos.length) {
    throw new ErroSubconta(motivoChave && campos.length === 1 ? motivoChave : 'Confira os campos destacados.', 422, { campos, codigo: 'DADOS_INVALIDOS' });
  }
  return { negocio, responsavel, repasse };
}

function normalizarChavePix(tipo, chave) {
  const t = String(tipo || '').toUpperCase();
  const c = typeof chave === 'string' ? chave.trim() : '';
  if (t === 'CNPJ' || t === 'CPF') return soDigitos(c);
  if (t === 'PHONE') {
    const d = soDigitos(c);
    return d.length === 10 || d.length === 11 ? d : d.replace(/^55/, '');
  }
  if (t === 'EMAIL') return c.toLowerCase();
  return c.toLowerCase();
}

/** null = ok; texto = motivo. A conta do repasse precisa ser do mesmo CNPJ. */
function validarChavePix(tipo, chave, { cnpj } = {}) {
  if (!TIPOS_CHAVE_PIX.includes(tipo)) return 'Escolha o tipo da chave Pix.';
  if (!chave) return 'Informe a chave Pix.';
  if (tipo === 'CNPJ') {
    if (!validarCnpj(chave)) return 'CNPJ da chave Pix inválido.';
    if (cnpj && chave !== cnpj) return 'A chave Pix tem que ser do mesmo CNPJ da conta.';
  }
  if (tipo === 'CPF' && !validarCpf(chave)) return 'CPF da chave Pix inválido.';
  if (tipo === 'EMAIL' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(chave)) return 'E-mail da chave Pix inválido.';
  if (tipo === 'PHONE' && (chave.length < 10 || chave.length > 11)) return 'Celular da chave Pix inválido.';
  if (tipo === 'EVP' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(chave)) return 'Chave aleatória inválida.';
  return null;
}

/**
 * Corpo do POST /accounts. Webhooks da subconta so entram com a URL publica
 * da API configurada (https): pagamentos -> /webhooks/pagamento/asaas (com o
 * segredo proprio da subconta) e status da conta -> /webhooks/assinatura/asaas
 * (com o token da plataforma e o id da nossa conta na query).
 */
function montarPayloadSubconta(dados, { webhookSecret, apiUrlPublica, tokenWebhookPlataforma, contaId } = {}) {
  const { negocio } = dados;
  const corpo = {
    name: negocio.razaoSocial,
    email: negocio.email,
    loginEmail: negocio.email,
    cpfCnpj: negocio.cnpj,
    companyType: negocio.tipoEmpresa,
    mobilePhone: negocio.telefone,
    incomeValue: Math.round(negocio.faturamentoMensal * 100) / 100,
    address: negocio.endereco,
    addressNumber: negocio.numero,
    complement: negocio.complemento || undefined,
    province: negocio.bairro,
    postalCode: negocio.cep,
  };
  const base = String(apiUrlPublica || '').replace(/\/$/, '');
  const webhooks = [];
  if (/^https:\/\//.test(base) && webhookSecret) {
    webhooks.push({
      name: 'Sellergy - pagamentos',
      url: `${base}/webhooks/pagamento/asaas`,
      email: negocio.email,
      sendType: 'SEQUENTIALLY',
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: webhookSecret,
      events: EVENTOS_PAGAMENTO,
    });
  }
  // O Asaas exige token com 32+ caracteres; mais curto, a conta e conferida so
  // pelo botao "Atualizar status".
  if (/^https:\/\//.test(base) && tokenWebhookPlataforma && String(tokenWebhookPlataforma).length >= 32 && contaId) {
    webhooks.push({
      name: 'Sellergy - status da conta',
      url: `${base}/webhooks/assinatura/asaas?conta=${encodeURIComponent(contaId)}`,
      email: negocio.email,
      sendType: 'SEQUENTIALLY',
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: tokenWebhookPlataforma,
      events: EVENTOS_CONTA,
    });
  }
  if (webhooks.length) corpo.webhooks = webhooks;
  return corpo;
}

/** Status do Asaas (myAccount/status ou accountStatus do webhook) -> nosso. */
function mapearStatusConta(st) {
  const geral = String(st?.general || '').toUpperCase();
  if (geral === 'APPROVED') return 'ATIVA';
  if (geral === 'REJECTED') return 'RECUSADA';
  return 'EM_ANALISE';
}

/** Motivo legivel quando recusada (o Asaas so devolve os status por area). */
function motivoRecusa(st) {
  const areas = { commercialInfo: 'dados do negócio', bankAccountInfo: 'conta bancária', documentation: 'documentos' };
  const recusadas = Object.entries(areas).filter(([k]) => String(st?.[k] || '').toUpperCase() === 'REJECTED').map(([, v]) => v);
  return recusadas.length ? `O Asaas recusou: ${recusadas.join(', ')}.` : 'O Asaas recusou a abertura da conta.';
}

/** Dados que podem voltar pro navegador (CPF mascarado, sem segredo). */
function dadosPublicos(dados) {
  if (!dados) return null;
  const { negocio = {}, responsavel = {}, repasse = {} } = dados;
  const mascarar = (d) => (d && d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : null);
  return {
    negocio: {
      cnpj: negocio.cnpj, razaoSocial: negocio.razaoSocial, nomeFantasia: negocio.nomeFantasia,
      tipoEmpresa: negocio.tipoEmpresa, email: negocio.email, telefone: negocio.telefone,
      cep: negocio.cep, endereco: negocio.endereco, numero: negocio.numero, complemento: negocio.complemento, bairro: negocio.bairro,
    },
    responsavel: { nome: responsavel.nome, cpf: mascarar(responsavel.cpf) },
    repasse: { prazo: repasse.prazo, tipoChavePix: repasse.tipoChavePix, chavePix: repasse.chavePix },
  };
}

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------

/**
 * @param {string} caminho  ex.: '/accounts'
 * @param {{metodo?:string, corpo?:Object, apiKey?:string, tentativas?:number}} [opts]
 *   apiKey: chave da SUBCONTA; sem ela, usa a da plataforma.
 */
async function chamar(caminho, { metodo = 'GET', corpo, apiKey, tentativas } = {}) {
  const chave = apiKey || process.env.ASAAS_PLATAFORMA_API_KEY;
  if (!chave) throw new ErroSubconta('Abertura automática de conta desligada.', 503, { codigo: 'SUBCONTA_DESLIGADA' });
  const resp = await fetchComRetentativa(`${baseUrl()}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'sellergy-cloud', access_token: chave },
    body: corpo ? JSON.stringify(corpo) : undefined,
  }, { timeoutMs: 20_000, tentativas: tentativas || (metodo === 'GET' ? 3 : 1) });
  const bruto = await resp.text();
  let json = null;
  try { json = bruto ? JSON.parse(bruto) : null; } catch { json = null; }
  if (!resp.ok) {
    // Nunca inclui a chave; so o que o Asaas respondeu.
    const msg = json?.errors?.map((e) => e.description).filter(Boolean).join(' ') || `O Asaas respondeu ${resp.status}.`;
    throw new ErroSubconta(msg, resp.status >= 500 ? 502 : 422, { detalhes: json?.errors || null, codigo: 'ASAAS_RECUSOU' });
  }
  return json;
}

async function criarSubconta(corpo) {
  const r = await chamar('/accounts', { metodo: 'POST', corpo, tentativas: 1 });
  if (!r?.id || !r?.apiKey) throw new ErroSubconta('O Asaas não devolveu a chave da conta.', 502);
  return { id: String(r.id), apiKey: String(r.apiKey), walletId: r.walletId ? String(r.walletId) : null };
}

const statusDaConta = (apiKey) => chamar('/myAccount/status', { apiKey });
const documentosPendentes = (apiKey) => chamar('/myAccount/documents', { apiKey });
const saldo = (apiKey) => chamar('/finance/balance', { apiKey });
const estatisticaRecebimentos = (apiKey, status) => chamar(`/finance/payment/statistics?status=${encodeURIComponent(status)}`, { apiKey });
const extrato = (apiKey, { limite = 30, offset = 0 } = {}) => chamar(`/financialTransactions?limit=${Number(limite)}&offset=${Number(offset)}&order=desc`, { apiKey });
const taxas = (apiKey) => chamar('/myAccount/fees', { apiKey });

async function transferirPix(apiKey, { valor, chavePix, tipoChavePix, descricao }) {
  return chamar('/transfers', {
    metodo: 'POST',
    apiKey,
    tentativas: 1,
    corpo: {
      value: Math.round(Number(valor) * 100) / 100,
      operationType: 'PIX',
      pixAddressKey: chavePix,
      pixAddressKeyType: tipoChavePix,
      description: descricao || 'Saque Sellergy',
    },
  });
}

/** Liga/desliga a antecipacao automatica do cartao (prazo "Tudo em 2 dias uteis"). */
async function configurarAntecipacao(apiKey, ligada) {
  return chamar('/anticipations/configurations', { metodo: 'PUT', apiKey, corpo: { creditCardAutomaticEnabled: Boolean(ligada) }, tentativas: 1 });
}

module.exports = {
  ativa,
  ambiente,
  baseUrl,
  ErroSubconta,
  validarDadosSubconta,
  validarChavePix,
  normalizarChavePix,
  montarPayloadSubconta,
  mapearStatusConta,
  motivoRecusa,
  dadosPublicos,
  chamar,
  criarSubconta,
  statusDaConta,
  documentosPendentes,
  saldo,
  estatisticaRecebimentos,
  extrato,
  taxas,
  transferirPix,
  configurarAntecipacao,
  TIPOS_EMPRESA,
  TIPOS_CHAVE_PIX,
  EVENTOS_CONTA,
  EVENTOS_PAGAMENTO,
};

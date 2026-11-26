// Interface (contrato) da camada plugavel fiscal.
// Pos-pivo ERP-first §5: o resto do sistema NAO sabe qual emissor esta em uso.
// Cada emissor (Focus NFe, Nuvem Fiscal) implementa esta interface num adapter;
// trocar de emissor nao mexe em venda/financeiro.
//
// MODO de operacao (igual a camada de pagamento):
//   - 'fixture' (atual): monta o request real (url/headers/body conforme a doc)
//     mas NAO bate na rede — devolve um DTO de fixture ja normalizado.
//   - 'live': executa o fetch de verdade (Fase 4).
//
// Emissao e ASSINCRONA no provedor: o fluxo normal e emitir -> PROCESSANDO ->
// (consultarStatus ate) EMITIDA | ERRO. Todo metodo devolve um DTO normalizado
// no vocabulario do model `DocumentoFiscal` (status do enum StatusDocumentoFiscal).

const { fetchComRetentativa } = require('../../utils/httpSeguro');

/**
 * Status normalizado (espelha o enum `DocumentoFiscal.status`).
 * @typedef {'PENDENTE'|'PROCESSANDO'|'EMITIDA'|'ERRO'|'CANCELADA'} StatusDoc
 */

/**
 * DTO normalizado de um documento fiscal.
 * @typedef {Object} DocumentoDTO
 * @property {string}    provedorDocId  id do documento no emissor
 * @property {StatusDoc} status
 * @property {string}    [numero]
 * @property {string}    [chave]        chave de acesso (44 digitos)
 * @property {string}    [urlPdf]       DANFE/DANFSE em PDF
 * @property {string}    [urlXml]
 * @property {string}    [mensagemErro]
 * @property {Object}    [bruto]        payload cru do emissor (debug)
 */

const STATUS = Object.freeze({
  PENDENTE: 'PENDENTE',
  PROCESSANDO: 'PROCESSANDO',
  EMITIDA: 'EMITIDA',
  ERRO: 'ERRO',
  CANCELADA: 'CANCELADA',
});

class ProvedorFiscal {
  /**
   * @param {Object} cfg
   * @param {Object} cfg.credencial  { tipo, nome, dados } decifrada do cofre
   * @param {Object} cfg.config      ConfiguracaoFiscal do tenant (cnpj, serie, csc, ambiente...)
   * @param {'producao'|'homologacao'} [cfg.ambiente]
   * @param {'fixture'|'live'} [cfg.modo]  default 'fixture' nesta fase
   */
  constructor({ credencial, config, ambiente = 'homologacao', modo = 'fixture' } = {}) {
    if (new.target === ProvedorFiscal) {
      throw new Error('ProvedorFiscal e abstrata — use um adapter concreto.');
    }
    this.credencial = credencial || null;
    this.config = config || {};
    this.ambiente = ambiente;
    this.modo = modo;
  }

  /** Identificador do emissor (espelha enum `DocumentoFiscal.provedor`). */
  static get provedor() { throw new Error('not implemented'); }

  /** Emite NFC-e (loja/varejo). @param {Object} _p @returns {Promise<DocumentoDTO>} */
  async emitirNFCe(_p) { throw new Error('not implemented'); }

  /** Emite NFS-e (servico/clinica). @param {Object} _p @returns {Promise<DocumentoDTO>} */
  async emitirNFSe(_p) { throw new Error('not implemented'); }

  /** Consulta o status atual de um documento no emissor. @returns {Promise<DocumentoDTO>} */
  async consultarStatus(_provedorDocId) { throw new Error('not implemented'); }

  /** Cancela um documento emitido. @returns {Promise<{status:StatusDoc}>} */
  async cancelar(_provedorDocId, _motivo) { throw new Error('not implemented'); }

  // ----------------------------------------------------------------------
  // Infra interna compartilhada — fetch ou fixture, conforme o modo.
  // ----------------------------------------------------------------------
  async _executar(req, fixture) {
    if (this.modo === 'fixture') return fixture();

    // Timeout + retentativa com backoff (429/5xx) — ver utils/httpSeguro.js.
    const resp = await fetchComRetentativa(req.url, {
      method: req.metodo || 'GET',
      headers: { 'content-type': 'application/json', ...(req.headers || {}) },
      body: req.corpo ? JSON.stringify(req.corpo) : undefined,
    });
    const texto = await resp.text();
    let json = {};
    try { json = texto ? JSON.parse(texto) : {}; } catch { json = { mensagem: texto.slice(0, 300) }; }
    if (!resp.ok) {
      const motivo = mensagemDoEmissor(json);
      throw Object.assign(new Error(motivo
        ? `O emissor recusou (HTTP ${resp.status}): ${motivo}`
        : `Emissor ${this.constructor.provedor} HTTP ${resp.status}`), {
        status: 502, httpStatus: resp.status, codigo: 'FISCAL_ERRO', mensagemEmissor: motivo, detalhe: json,
      });
    }
    return json;
  }

  /**
   * Faltou dado obrigatorio para montar a nota: em 'live' bloqueia antes de
   * chamar o emissor (422 com a lista); em 'fixture' segue (facilita teste).
   */
  _exigirCompleto(faltas) {
    if (this.modo !== 'live' || !faltas || !faltas.length) return;
    throw Object.assign(new Error(`Falta para emitir a nota: ${[...new Set(faltas)].join('; ')}.`), {
      status: 422, codigo: 'FISCAL_DADOS_INCOMPLETOS', faltas: [...new Set(faltas)],
    });
  }
}

/**
 * Texto do erro devolvido pelo emissor, sem dado sensivel: mascara CPF/CNPJ,
 * e-mail e qualquer coisa com cara de token. Max 400 caracteres.
 */
function mensagemDoEmissor(json) {
  if (!json || typeof json !== 'object') return '';
  const partes = [];
  const add = (v) => { if (typeof v === 'string' && v.trim()) partes.push(v.trim()); };
  add(json.mensagem);
  add(json.mensagem_sefaz);
  add(json.message);
  add(json.error?.message);
  add(typeof json.error === 'string' ? json.error : null);
  for (const lista of [json.erros, json.errors, json.error?.errors, json.mensagens]) {
    if (Array.isArray(lista)) lista.slice(0, 5).forEach((e) => add(typeof e === 'string' ? e : e?.mensagem || e?.message || e?.descricao));
  }
  return sanitizarMensagem([...new Set(partes)].join(' | '));
}

function sanitizarMensagem(texto) {
  return String(texto || '')
    .replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer ***')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '**.***.***/****-**')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '***.***.***-**')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '***')
    .slice(0, 400);
}

module.exports = { ProvedorFiscal, STATUS, mensagemDoEmissor, sanitizarMensagem };

// Adapter Nuvem Fiscal — implementa ProvedorFiscal.
// Doc: https://dev.nuvemfiscal.com.br/docs/api
//
// Ambiente: homologacao -> https://api.sandbox.nuvemfiscal.com.br ;
// producao -> https://api.nuvemfiscal.com.br. A MESMA regra vale para o envio
// do certificado (fiscal/certificado.js usa baseUrl daqui).
//
// Rotas por tipo:
//   NFC-e: POST /nfce       · GET /nfce/{id}  · POST /nfce/{id}/cancelamento
//   NFS-e: POST /nfse/dps   · GET /nfse/{id}  · POST /nfse/{id}/cancelamento
//
// Auth: Bearer. O token OAuth (client_credentials em
// https://auth.nuvemfiscal.com.br/oauth/token) vence (~30 dias). Se a
// credencial tiver clientId + clientSecret, o token e obtido e renovado
// sozinho (cache em memoria ate perto de vencer; 401 forca renovacao e uma
// nova tentativa). So com accessToken, um 401 vira erro claro pedindo para
// atualizar a credencial.

const { fetchComRetentativa } = require('../../utils/httpSeguro');
const { ProvedorFiscal, STATUS } = require('./ProvedorFiscal');
const { montarDadosNota, corpoNuvemNFCe, corpoNuvemNFSe } = require('./corpoNota');

const URL_TOKEN = 'https://auth.nuvemfiscal.com.br/oauth/token';
const ESCOPO = 'empresa cep cnpj nfce nfse';
const MARGEM_RENOVACAO_MS = 5 * 60 * 1000;

function baseUrl(ambiente) {
  return ambiente === 'producao'
    ? 'https://api.nuvemfiscal.com.br'
    : 'https://api.sandbox.nuvemfiscal.com.br';
}

function caminhoPorTipo(tipo) {
  return String(tipo || '').toUpperCase() === 'NFSE' ? 'nfse' : 'nfce';
}

function normalizar(s) {
  switch (s) {
    case 'autorizado': return STATUS.EMITIDA;
    case 'pendente':
    case 'processando': return STATUS.PROCESSANDO;
    case 'cancelado': return STATUS.CANCELADA;
    case 'rejeitado':
    case 'denegado':
    case 'erro': return STATUS.ERRO;
    default: return STATUS.PROCESSANDO;
  }
}

function mensagemNuvem(raw) {
  return raw?.autorizacao?.motivo_status || raw?.mensagens?.[0]?.descricao || raw?.mensagem || raw?.error?.message || undefined;
}

// --------------------------- token OAuth ----------------------------------
const cacheTokens = new Map(); // clientId -> { token, expiraEm }

async function obterTokenOAuth({ clientId, clientSecret }, { forcar = false, agora = Date.now(), buscar = fetchComRetentativa } = {}) {
  const atual = cacheTokens.get(clientId);
  if (!forcar && atual && atual.expiraEm - agora > MARGEM_RENOVACAO_MS) return atual.token;
  const resp = await buscar(URL_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: ESCOPO }).toString(),
  });
  if (!resp.ok) {
    cacheTokens.delete(clientId);
    throw Object.assign(new Error('A Nuvem Fiscal recusou o acesso (client_id/client_secret). Confira a integração.'), {
      status: 502, codigo: 'FISCAL_TOKEN', httpStatus: resp.status,
    });
  }
  const json = await resp.json();
  const token = json.access_token;
  const expiraEm = agora + Math.max(60, Number(json.expires_in) || 3600) * 1000;
  cacheTokens.set(clientId, { token, expiraEm });
  return token;
}

function limparCacheTokens() { cacheTokens.clear(); }

class NuvemFiscalAdapter extends ProvedorFiscal {
  static get provedor() { return 'NUVEM_FISCAL'; }

  get _dados() { return this.credencial?.dados || {}; }
  get _temOAuth() { return Boolean(this._dados.clientId && this._dados.clientSecret); }

  async _token({ forcar = false } = {}) {
    if (this._temOAuth) return obterTokenOAuth(this._dados, { forcar });
    return this._dados.accessToken || this._dados.token || '';
  }

  async _headers(opts) { return { Authorization: `Bearer ${await this._token(opts)}` }; }

  get _base() { return baseUrl(this.ambiente); }

  /** Executa com o Bearer atual; 401 com OAuth -> renova o token e tenta 1x de novo. */
  async _chamar(req, fixture) {
    if (this.modo === 'fixture') return fixture();
    try {
      return await this._executar({ ...req, headers: await this._headers() }, fixture);
    } catch (e) {
      if (e.httpStatus !== 401) throw e;
      if (!this._temOAuth) {
        throw Object.assign(new Error('O token da Nuvem Fiscal venceu ou foi recusado. Atualize a credencial (ou cadastre client_id e client_secret para renovar sozinho).'), {
          status: 502, codigo: 'FISCAL_TOKEN_VENCIDO',
        });
      }
      return this._executar({ ...req, headers: await this._headers({ forcar: true }) }, fixture);
    }
  }

  /** Corpo real da nota (sem chamar a rede). Exposto para teste. */
  montarCorpo(tipo, params = {}) {
    const { dados, faltas } = montarDadosNota({ ...params, tipo, config: this.config, ambiente: this.ambiente });
    const r = tipo === 'NFCE' ? corpoNuvemNFCe(dados) : corpoNuvemNFSe(dados);
    return { corpo: r.corpo, faltas: [...faltas, ...r.faltas] };
  }

  async _emitir(tipo, params) {
    const { refExterna } = params;
    const { corpo, faltas } = this.montarCorpo(tipo, params);
    this._exigirCompleto(faltas);
    const req = {
      url: tipo === 'NFCE' ? `${this._base}/nfce` : `${this._base}/nfse/dps`,
      metodo: 'POST',
      corpo,
    };
    const raw = await this._chamar(req, () => ({ id: `nf_${refExterna}`, status: 'pendente' }));
    return {
      provedorDocId: String(raw.id),
      status: normalizar(raw.status),
      mensagemErro: mensagemNuvem(raw),
      bruto: raw,
    };
  }

  emitirNFCe(p) { return this._emitir('NFCE', p); }
  emitirNFSe(p) { return this._emitir('NFSE', p); }

  /** @param {string} provedorDocId  @param {'NFCE'|'NFSE'} [tipo='NFCE'] */
  async consultarStatus(provedorDocId, tipo = 'NFCE') {
    const caminho = caminhoPorTipo(tipo);
    const id = encodeURIComponent(provedorDocId);
    const req = { url: `${this._base}/${caminho}/${id}` };
    const raw = await this._chamar(req, () => ({
      id: provedorDocId,
      status: 'autorizado',
      numero: '1234',
      chave: caminho === 'nfce' ? '35200114200166000187650010000012341000012345' : undefined,
    }));
    return {
      provedorDocId: String(provedorDocId),
      status: normalizar(raw.status),
      numero: raw.numero != null ? String(raw.numero) : undefined,
      chave: raw.chave || raw.codigo_verificacao,
      // A Nuvem serve PDF e XML em /{tipo}/{id}/pdf e /{tipo}/{id}/xml (com Bearer).
      urlPdf: raw.status === 'autorizado' ? `${this._base}/${caminho}/${id}/pdf` : undefined,
      urlXml: raw.status === 'autorizado' ? `${this._base}/${caminho}/${id}/xml` : undefined,
      mensagemErro: mensagemNuvem(raw),
      bruto: raw,
    };
  }

  /** @param {string} provedorDocId  @param {string} motivo  @param {'NFCE'|'NFSE'} [tipo='NFCE'] */
  async cancelar(provedorDocId, motivo, tipo = 'NFCE') {
    const caminho = caminhoPorTipo(tipo);
    const req = {
      url: `${this._base}/${caminho}/${encodeURIComponent(provedorDocId)}/cancelamento`,
      metodo: 'POST',
      corpo: { justificativa: motivo },
    };
    const raw = await this._chamar(req, () => ({ status: 'registrado' }));
    // O cancelamento e um evento: 'registrado' (ou 'cancelado') = aceito.
    const ok = ['registrado', 'cancelado', 'autorizado'].includes(raw.status);
    if (ok) return { status: STATUS.CANCELADA };
    if (raw.status === 'pendente' || raw.status === 'processando') return { status: STATUS.PROCESSANDO };
    return { status: STATUS.ERRO, mensagemErro: mensagemNuvem(raw) || 'O emissor não aceitou o cancelamento.' };
  }
}

NuvemFiscalAdapter.baseUrl = baseUrl;
NuvemFiscalAdapter.caminhoPorTipo = caminhoPorTipo;
NuvemFiscalAdapter.obterTokenOAuth = obterTokenOAuth;
NuvemFiscalAdapter.limparCacheTokens = limparCacheTokens;
module.exports = NuvemFiscalAdapter;

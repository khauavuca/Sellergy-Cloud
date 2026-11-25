// Adapter Focus NFe — implementa ProvedorFiscal.
// Auth: Basic com o token como usuario (senha vazia). Base homologacao:
// https://homologacao.focusnfe.com.br · producao: https://api.focusnfe.com.br.
// Emissao por `ref` (idempotente). Rotas por tipo (doc https://focusnfe.com.br/doc/):
//   NFC-e: POST /v2/nfce?ref=  · GET /v2/nfce/{ref}  · DELETE /v2/nfce/{ref}
//   NFS-e: POST /v2/nfse?ref=  · GET /v2/nfse/{ref}  · DELETE /v2/nfse/{ref}
// O provedorDocId guardado e a propria `ref` (= id do DocumentoFiscal).

const { ProvedorFiscal, STATUS } = require('./ProvedorFiscal');
const { montarDadosNota, corpoFocusNFCe, corpoFocusNFSe } = require('./corpoNota');

function baseUrl(ambiente) {
  return ambiente === 'producao'
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br';
}

/** Caminho da API por tipo de documento (NFS-e nunca vai no endereco de NFC-e). */
function caminhoPorTipo(tipo) {
  return String(tipo || '').toUpperCase() === 'NFSE' ? 'v2/nfse' : 'v2/nfce';
}

// status do Focus -> status normalizado
function normalizar(s) {
  switch (s) {
    case 'autorizado': return STATUS.EMITIDA;
    case 'processando_autorizacao': return STATUS.PROCESSANDO;
    case 'cancelado': return STATUS.CANCELADA;
    case 'erro_autorizacao':
    case 'erro_cancelamento':
    case 'denegado': return STATUS.ERRO;
    default: return STATUS.PROCESSANDO;
  }
}

function mensagemFocus(raw) {
  return raw?.mensagem_sefaz || raw?.mensagem || raw?.erros?.[0]?.mensagem || undefined;
}

class FocusNFeAdapter extends ProvedorFiscal {
  static get provedor() { return 'FOCUS_NFE'; }

  get _token() { return this.credencial?.dados?.token || this.credencial?.dados?.apiKey; }

  _auth() {
    const b64 = Buffer.from(`${this._token || ''}:`).toString('base64');
    return { Authorization: `Basic ${b64}` };
  }

  /** Corpo real da nota (sem chamar a rede). Exposto para teste. */
  montarCorpo(tipo, params = {}) {
    const { dados, faltas } = montarDadosNota({ ...params, tipo, config: this.config, ambiente: this.ambiente });
    const r = tipo === 'NFCE' ? corpoFocusNFCe(dados) : corpoFocusNFSe(dados);
    return { corpo: r.corpo, faltas: [...faltas, ...r.faltas] };
  }

  async _emitir(tipo, params) {
    const { refExterna } = params;
    const { corpo, faltas } = this.montarCorpo(tipo, params);
    this._exigirCompleto(faltas);
    const req = {
      url: `${baseUrl(this.ambiente)}/${caminhoPorTipo(tipo)}?ref=${encodeURIComponent(refExterna)}`,
      metodo: 'POST',
      headers: this._auth(),
      corpo,
    };
    const raw = await this._executar(req, () => ({ status: 'processando_autorizacao', ref: refExterna }));
    return {
      provedorDocId: String(raw.ref || refExterna),
      status: normalizar(raw.status),
      mensagemErro: mensagemFocus(raw),
      bruto: raw,
    };
  }

  emitirNFCe(p) { return this._emitir('NFCE', p); }
  emitirNFSe(p) { return this._emitir('NFSE', p); }

  /** @param {string} provedorDocId  @param {'NFCE'|'NFSE'} [tipo='NFCE'] */
  async consultarStatus(provedorDocId, tipo = 'NFCE') {
    const base = baseUrl(this.ambiente);
    const ref = encodeURIComponent(provedorDocId);
    const req = { url: `${base}/${caminhoPorTipo(tipo)}/${ref}`, headers: this._auth() };
    const ehNfse = String(tipo).toUpperCase() === 'NFSE';
    const raw = await this._executar(req, () => (ehNfse ? {
      status: 'autorizado',
      numero: '1234',
      codigo_verificacao: 'ABCD1234',
      url: `${base}/notas_fiscais_servico/${provedorDocId}`,
      caminho_xml_nota_fiscal: `/notas/${provedorDocId}/nfse.xml`,
    } : {
      status: 'autorizado',
      numero: '000001234',
      chave_nfe: '35200114200166000187650010000012341000012345',
      caminho_danfe: `/notas/${provedorDocId}/danfe.pdf`,
      caminho_xml_nota_fiscal: `/notas/${provedorDocId}/nota.xml`,
    }));
    const absoluto = (c) => (c ? (/^https?:\/\//.test(c) ? c : `${base}${c}`) : undefined);
    return {
      provedorDocId: String(provedorDocId),
      status: normalizar(raw.status),
      numero: raw.numero,
      chave: raw.chave_nfe || raw.codigo_verificacao,
      // NFS-e: a Focus devolve `url` (link da prefeitura) e `url_danfse`; NFC-e: caminho_danfe.
      urlPdf: absoluto(raw.caminho_danfe || raw.url_danfse || raw.url),
      urlXml: absoluto(raw.caminho_xml_nota_fiscal),
      mensagemErro: mensagemFocus(raw),
      bruto: raw,
    };
  }

  /** @param {string} provedorDocId  @param {string} motivo  @param {'NFCE'|'NFSE'} [tipo='NFCE'] */
  async cancelar(provedorDocId, motivo, tipo = 'NFCE') {
    const req = {
      url: `${baseUrl(this.ambiente)}/${caminhoPorTipo(tipo)}/${encodeURIComponent(provedorDocId)}`,
      metodo: 'DELETE',
      headers: this._auth(),
      corpo: { justificativa: motivo },
    };
    const raw = await this._executar(req, () => ({ status: 'cancelado' }));
    const status = normalizar(raw.status);
    return {
      status: status === STATUS.CANCELADA ? STATUS.CANCELADA : status,
      mensagemErro: status === STATUS.CANCELADA ? undefined : mensagemFocus(raw),
    };
  }
}

FocusNFeAdapter.baseUrl = baseUrl;
FocusNFeAdapter.caminhoPorTipo = caminhoPorTipo;
module.exports = FocusNFeAdapter;

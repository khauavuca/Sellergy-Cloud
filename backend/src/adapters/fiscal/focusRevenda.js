// =====================================================================
// FOCUS NFe — CONTA DE REVENDA DA SELLERGY
// =====================================================================
// A Sellergy tem UMA conta na Focus (chave da plataforma FOCUS_NFE_KEY, o
// "Token Master"). O cliente nao cria conta nem cola chave: o assistente
// fiscal manda os dados da empresa + certificado A1 + CSC e aqui cadastramos
// a empresa dele na nossa conta (POST /v2/empresas). A Focus devolve um token
// por empresa (producao e homologacao); ele vira a credencial FOCUS_NFE_KEY
// do cliente, e a emissao continua igual (adapters/fiscal/focusNFe.js).
//
// Doc: https://doc.focusnfe.com.br/reference/criar_empresa (so producao;
// `dry_run=1` simula). Auth: Basic com o token como usuario.
// =====================================================================

const { fetchComRetentativa } = require('../../utils/httpSeguro');

const BASE = 'https://api.focusnfe.com.br/v2/empresas';

// Regime tributario da Focus: 1 Simples, 2 Simples (excesso de sublimite),
// 3 regime normal (Presumido/Real), 4 MEI.
const REGIME_FOCUS = { MEI: 4, 'Simples Nacional': 1, 'Lucro Presumido': 3, 'Lucro Real': 3 };

/**
 * Regra pura: corpo do cadastro da empresa na Focus a partir da
 * ConfiguracaoFiscal. `tipos` diz o que o negocio emite (NFSE/NFCE).
 * Certificado e CSC so entram quando vieram (atualizacao parcial).
 */
function montarEmpresaFocus(config, { tipos = ['NFSE', 'NFCE'], certificado = null } = {}) {
  const c = config || {};
  const corpo = {
    nome: c.razaoSocial,
    nome_fantasia: c.nomeFantasia || c.razaoSocial,
    cnpj: String(c.cnpj || '').replace(/\D/g, ''),
    // "ISENTO" nao vai: a Focus espera so os digitos da inscricao.
    inscricao_estadual: /^\d+$/.test(String(c.inscricao || '')) ? String(c.inscricao) : undefined,
    inscricao_municipal: String(c.inscricaoMunicipal || '').replace(/\D/g, '') || undefined,
    regime_tributario: REGIME_FOCUS[c.regime] || 1,
    email: c.emailEmitente || undefined,
    telefone: c.telefoneEmitente || undefined,
    logradouro: c.logradouro,
    numero: c.numero,
    complemento: c.complemento || undefined,
    bairro: c.bairro || undefined,
    municipio: c.municipio,
    uf: c.uf,
    cep: String(c.cep || '').replace(/\D/g, ''),
    habilita_nfe: false,
    habilita_nfce: tipos.includes('NFCE'),
    // NFS-e municipal (/v2/nfse), que e o que a emissao usa hoje. A Focus nao
    // deixa ligar junto com a NFS-e nacional (habilita_nfsen_*): quando a
    // emissao passar pro padrao nacional, trocar os dois juntos.
    habilita_nfse: tipos.includes('NFSE'),
  };
  if (tipos.includes('NFCE') && c.csc && c.cscId) {
    corpo.csc_nfce_producao = c.csc;
    corpo.id_token_nfce_producao = Number(c.cscId); // a Focus pede inteiro (000001 -> 1)
  }
  if (certificado?.base64 && certificado?.senha) {
    corpo.arquivo_certificado_base64 = certificado.base64;
    corpo.senha_certificado = certificado.senha;
  }
  // Tira os vazios: a Focus trata campo presente como "apagar".
  return Object.fromEntries(Object.entries(corpo).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/** Mensagem da Focus para gente (ela devolve { mensagem } ou { erros: [{ mensagem }] }). */
function explicarErroFocus(status, corpo) {
  const msgs = [corpo?.mensagem, ...(Array.isArray(corpo?.erros) ? corpo.erros.map((e) => e?.mensagem) : [])]
    .filter((m) => typeof m === 'string' && m.trim())
    .map((m) => m.trim());
  const texto = msgs.join(' ').toLowerCase();
  if (/certificado.*(vencid|expirad)/.test(texto)) return 'O emissor recusou: o certificado está vencido.';
  if (/certificado.*cnpj|cnpj.*certificado/.test(texto)) return 'O emissor recusou: o certificado é de outro CNPJ.';
  if (/senha/.test(texto)) return 'O emissor recusou a senha do certificado.';
  if (status === 401 || status === 403) return 'A conta de notas da Sellergy recusou o acesso. Avise o suporte.';
  if (msgs.length) return `O emissor recusou: ${msgs.slice(0, 2).join(' ')}`.slice(0, 300);
  return 'O emissor não aceitou os dados agora. Tente de novo em alguns minutos.';
}

/**
 * Cria (sem empresaId) ou atualiza (com empresaId) a empresa na conta da Sellergy.
 * @returns {Promise<{ ok: true, empresaId, tokenProducao, tokenHomologacao } | { ok: false, status, erro }>}
 */
async function salvarEmpresaFocus({ masterToken, empresaId = null, corpo, fetchFn = fetchComRetentativa }) {
  const url = empresaId ? `${BASE}/${encodeURIComponent(empresaId)}` : BASE;
  let resp;
  try {
    resp = await fetchFn(url, {
      method: empresaId ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Basic ${Buffer.from(`${masterToken}:`).toString('base64')}` },
      body: JSON.stringify(corpo),
    }, { timeoutMs: 20000, tentativas: 1 });
  } catch {
    return { ok: false, status: 503, erro: 'O emissor não respondeu agora. Tente de novo em alguns minutos.' };
  }
  let j = null;
  try { j = await resp.json(); } catch { j = null; }
  if (!resp.ok) return { ok: false, status: resp.status, erro: explicarErroFocus(resp.status, j) };
  const id = j?.id != null ? String(j.id) : empresaId;
  let tokenProducao = j?.token_producao || null;
  let tokenHomologacao = j?.token_homologacao || null;
  // A doc mostra os tokens vazios no retorno do cadastro: consulta a empresa uma vez.
  if (id && (!tokenProducao || !tokenHomologacao)) {
    const consulta = await consultarEmpresaFocus({ masterToken, empresaId: id, fetchFn });
    tokenProducao = tokenProducao || consulta?.tokenProducao || null;
    tokenHomologacao = tokenHomologacao || consulta?.tokenHomologacao || null;
  }
  return { ok: true, empresaId: id, tokenProducao, tokenHomologacao };
}

/** GET /v2/empresas/{id} — so pra buscar os tokens. Falha = null. */
async function consultarEmpresaFocus({ masterToken, empresaId, fetchFn = fetchComRetentativa }) {
  try {
    const resp = await fetchFn(`${BASE}/${encodeURIComponent(empresaId)}`, {
      method: 'GET',
      headers: { Authorization: `Basic ${Buffer.from(`${masterToken}:`).toString('base64')}` },
    }, { timeoutMs: 15000, tentativas: 2 });
    if (!resp.ok) return null;
    const j = await resp.json();
    return { tokenProducao: j?.token_producao || null, tokenHomologacao: j?.token_homologacao || null };
  } catch {
    return null;
  }
}

module.exports = { montarEmpresaFocus, salvarEmpresaFocus, consultarEmpresaFocus, explicarErroFocus, REGIME_FOCUS };

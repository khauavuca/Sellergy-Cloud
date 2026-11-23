// =====================================================================
// CERTIFICADO A1 — confere o .pfx e manda direto pro emissor fiscal.
// =====================================================================
// Regra da casa (utils/validacaoFiscal#conteudoCertificadoProibido): o
// certificado NAO fica conosco. O arquivo e a senha so existem em memoria
// durante a requisicao: abrimos o .pfx pra conferir a senha e ler titular e
// validade, enviamos ao provedor (Focus NFe / Nuvem Fiscal) e guardamos so a
// REFERENCIA (certificadoRef), o titular e a validade.
// =====================================================================

const tls = require('tls');
const { fetchComRetentativa } = require('../utils/httpSeguro');
const { soDigitos, validarCnpj } = require('../utils/validacaoFiscal');

const TAMANHO_MAX = 64 * 1024; // .pfx de A1 tem poucos KB

function erro(status, mensagem, codigo) {
  return Object.assign(new Error(mensagem), { status, codigo });
}

/** CNPJ do titular: no ICP-Brasil vem no CN como "RAZAO SOCIAL:CNPJ". */
function cnpjDoTitular(cn) {
  const m = String(cn || '').match(/:(\d{14})\b/);
  return m && validarCnpj(m[1]) ? m[1] : null;
}

/**
 * Abre o .pfx com a senha e devolve { titular, cnpj, validoAte, validoDe }.
 * Senha errada / arquivo que nao e certificado -> erro 422.
 */
function lerCertificadoA1(buffer, senha) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw erro(422, 'Escolha o arquivo .pfx do certificado.', 'SEM_ARQUIVO');
  if (buffer.length > TAMANHO_MAX) throw erro(422, 'Esse arquivo é grande demais para um certificado A1.', 'ARQUIVO_GRANDE');
  if (typeof senha !== 'string' || !senha) throw erro(422, 'Digite a senha do certificado.', 'SEM_SENHA');
  // PKCS#12 e uma SEQUENCE DER: sempre comeca com 0x30.
  if (buffer[0] !== 0x30) throw erro(422, 'Esse arquivo não é um certificado .pfx.', 'NAO_E_PFX');

  let cert;
  try {
    const contexto = tls.createSecureContext({ pfx: buffer, passphrase: senha });
    const socket = new tls.TLSSocket(null, { secureContext: contexto });
    cert = socket.getCertificate();
    socket.destroy();
  } catch (e) {
    const msg = String(e?.message || '');
    if (/mac verify|bad decrypt|password|invalid password/i.test(msg)) throw erro(422, 'Senha do certificado incorreta.', 'SENHA_ERRADA');
    throw erro(422, 'Não conseguimos abrir esse certificado. Confira se é o arquivo .pfx (A1).', 'PFX_INVALIDO');
  }
  if (!cert || !cert.valid_to) throw erro(422, 'O arquivo não tem um certificado válido dentro.', 'PFX_INVALIDO');

  const validoAte = new Date(cert.valid_to);
  const validoDe = new Date(cert.valid_from);
  const cn = Array.isArray(cert.subject?.CN) ? cert.subject.CN[0] : cert.subject?.CN;
  if (Number.isNaN(validoAte.getTime())) throw erro(422, 'Não conseguimos ler a validade do certificado.', 'PFX_INVALIDO');
  if (validoAte.getTime() <= Date.now()) throw erro(422, `Este certificado venceu em ${validoAte.toLocaleDateString('pt-BR')}.`, 'VENCIDO');
  return {
    titular: String(cn || cert.subject?.O || 'Titular não informado').split(':')[0].slice(0, 120),
    cnpj: cnpjDoTitular(cn),
    validoAte,
    validoDe,
  };
}

function modoEnvio(credencial) {
  return String(process.env.FISCAL_LIVE || '').toLowerCase() === 'true' && credencial ? 'live' : 'fixture';
}

/**
 * Envia o certificado ao emissor e devolve a referencia que fica no banco.
 * Em 'fixture' (padrao, sem FISCAL_LIVE=true) nao bate na rede.
 */
async function enviarAoProvedor({ provedor, credencial, cnpj, buffer, senha, ambiente = 'homologacao' }) {
  const doc = soDigitos(cnpj);
  const modo = modoEnvio(credencial);
  const ref = `${provedor}:empresa:${doc}`;
  if (modo === 'fixture') return { certificadoRef: ref, simulado: true };

  const base64 = buffer.toString('base64');
  let req;
  if (provedor === 'FOCUS_NFE') {
    const token = credencial?.dados?.token || credencial?.dados?.apiKey || '';
    req = {
      // API de revenda da Focus (cadastro da empresa emitente com o A1).
      url: 'https://api.focusnfe.com.br/v2/empresas',
      metodo: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` },
      corpo: { cnpj: doc, arquivo_certificado_base64: base64, senha_certificado: senha },
    };
  } else if (provedor === 'NUVEM_FISCAL') {
    const token = credencial?.dados?.accessToken || credencial?.dados?.token || '';
    const base = ambiente === 'producao' ? 'https://api.nuvemfiscal.com.br' : 'https://api.sandbox.nuvemfiscal.com.br';
    req = {
      url: `${base}/empresas/${doc}/certificado`,
      metodo: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      corpo: { certificado: base64, password: senha },
    };
  } else {
    throw erro(400, 'Emissor fiscal desconhecido.', 'PROVEDOR_INVALIDO');
  }

  const resp = await fetchComRetentativa(req.url, {
    method: req.metodo,
    headers: { 'content-type': 'application/json', ...req.headers },
    body: JSON.stringify(req.corpo),
  });
  if (!resp.ok) {
    throw erro(502, resp.status === 401 || resp.status === 403
      ? 'O emissor recusou o acesso. Peça ao suporte para conferir a integração.'
      : 'O emissor não aceitou o certificado agora. Tente de novo em alguns minutos.', 'PROVEDOR_RECUSOU');
  }
  return { certificadoRef: ref, simulado: false };
}

module.exports = { lerCertificadoA1, enviarAoProvedor, cnpjDoTitular, modoEnvio, TAMANHO_MAX };

/**
 * Validações fiscais — núcleo de segurança/integridade da emissão.
 *
 * Tudo aqui é puro (sem I/O) e defensivo: documentos com dígito verificador,
 * códigos fiscais com tamanho exato, e o GATE de produção que impede emitir uma
 * nota real incompleta. Também a regra que mantém o certificado FORA do nosso
 * banco (fica no provedor) e o resolvedor de modo que nunca vai a 'live' por
 * acidente.
 */

const soDigitos = (s) => String(s ?? '').replace(/\D+/g, '');

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

// ---------- CNPJ / CPF com dígito verificador ----------
function validarCnpj(v) {
  const cnpj = soDigitos(v);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (pesos) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += Number(cnpj[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

function validarCpf(v) {
  const cpf = soDigitos(v);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (qtd) => {
    let soma = 0;
    for (let i = 0; i < qtd; i++) soma += Number(cpf[i]) * (qtd + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

// CNPJ (14) ou CPF (11). Vazio é "não informado" (decide o chamador).
function validarDocumento(v) {
  const d = soDigitos(v);
  if (d.length === 14) return validarCnpj(d);
  if (d.length === 11) return validarCpf(d);
  return false;
}

// ---------- Códigos fiscais (tamanho exato; vazio = não informado) ----------
const ehVazio = (v) => v === undefined || v === null || String(v).trim() === '';
const temNDigitos = (v, n) => new RegExp(`^\\d{${n}}$`).test(soDigitos(v));

const validarNcm = (v) => ehVazio(v) || temNDigitos(v, 8);
const validarCfop = (v) => ehVazio(v) || temNDigitos(v, 4);
const validarCest = (v) => ehVazio(v) || temNDigitos(v, 7);
const validarUf = (v) => ehVazio(v) || UFS.has(String(v).trim().toUpperCase());
const validarCep = (v) => ehVazio(v) || temNDigitos(v, 8);

// ---------- Modo de operação (fixture x live) ----------
// LIVE (emite de verdade no SEFAZ via provedor) só quando DUAS condições batem:
//   1. variável de ambiente FISCAL_LIVE === 'true' (opt-in deliberado do operador);
//   2. o tenant está com ambiente === 'PRODUCAO'.
// Sem isso, SEMPRE 'fixture' — nunca emite real por acidente.
function resolverModoFiscal(config) {
  const liveHabilitado = String(process.env.FISCAL_LIVE || '').toLowerCase() === 'true';
  return liveHabilitado && config?.ambiente === 'PRODUCAO' ? 'live' : 'fixture';
}

// ---------- Certificado: NUNCA fica conosco ----------
// O certificado digital (.pfx/PKCS#12) vai pro PROVEDOR; guardamos só uma
// referência (certificadoRef). Esta função detecta tentativa de mandar o
// conteúdo do certificado/senha pro nosso backend — que deve ser RECUSADA.
const CHAVES_CERTIFICADO = [
  'certificado', 'certificadoBase64', 'certificadoConteudo', 'certificadoArquivo',
  'pfx', 'pkcs12', 'p12', 'senhaCertificado', 'certificadoSenha', 'certPassword',
];
function conteudoCertificadoProibido(body) {
  if (!body || typeof body !== 'object') return null;
  for (const k of CHAVES_CERTIFICADO) {
    if (body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== '') return k;
  }
  // Heurística: um "certificadoRef" gigante provavelmente é o próprio binário.
  if (typeof body.certificadoRef === 'string' && body.certificadoRef.length > 200) return 'certificadoRef';
  return null;
}

// ---------- Gate de prontidão para PRODUÇÃO ----------
// Antes de emitir DE VERDADE, exige a identidade do emitente, o certificado (ref)
// e a credencial. Para NF-e real, cada item precisa de NCM e CFOP. Devolve a
// lista do que falta (vazia = pronto). Em fixture isto não é chamado.
// `tipo` (opcional): 'NFCE' exige inscrição estadual; 'NFSE' exige a
// municipal. Sem tipo, mantém a regra antiga (estadual).
function validarProntidaoProducao(config, itens = [], { tipo } = {}) {
  const falta = [];
  const c = config || {};
  if (!c.razaoSocial) falta.push('razão social do emitente');
  if (!validarCnpj(c.cnpj)) falta.push('CNPJ do emitente válido');
  if (tipo === 'NFSE') {
    if (!c.inscricaoMunicipal) falta.push('inscrição municipal');
  } else if (!c.inscricao) falta.push('inscrição estadual');
  if (!c.logradouro || !c.municipio || !validarUf(c.uf) || !validarCep(c.cep)) {
    falta.push('endereço do emitente (logradouro, município, UF, CEP)');
  }
  if (!c.certificadoRef) falta.push('certificado digital configurado no provedor');
  else if (String(c.certificadoRef).startsWith('simulado:')) falta.push('reenviar o certificado digital (o atual foi registrado em modo simulado e não está no emissor)');
  if (!c.credencialId) falta.push('credencial do provedor');
  itens.forEach((it, i) => {
    if (!temNDigitos(it?.ncm, 8)) falta.push(`NCM do item ${i + 1}`);
    if (!temNDigitos(it?.cfop, 4)) falta.push(`CFOP do item ${i + 1}`);
  });
  return falta;
}

// ---------- Dados tributários (ConfiguracaoFiscal.tributacao, JSON) ----------
// Tudo opcional. Normaliza e valida cada chave conhecida; ignora o resto.
// Devolve { dados } ou { erro, campos }.
//   codigoMunicipio            IBGE do município do emitente (7 dígitos)
//   naturezaOperacao           NFC-e (padrão "Venda ao consumidor")
//   ncmPadrao / cfopPadrao     usados só em item sem NCM/CFOP próprio
//   icmsSituacao               CSOSN (Simples) ou CST do ICMS (regime normal)
//   icmsAliquota               % (regime normal, CST 00)
//   pisCofinsSituacao          CST de PIS/COFINS (padrão 49 no Simples)
//   itemListaServico           NFS-e: item da LC 116 (ex. "06.01")
//   codigoTributacaoNacional   NFS-e nacional: cTribNac (6 dígitos)
//   codigoTributarioMunicipio  NFS-e: código do serviço na prefeitura
//   aliquotaIss                NFS-e: % do ISS
//   issRetido                  NFS-e: ISS retido pelo tomador
//   ibsCbs { incluir, cst, cClassTrib }  reforma tributária (ver adapters/fiscal/corpoNota)
function normalizarTributacao(entrada) {
  if (entrada === null || entrada === undefined) return { dados: null };
  if (typeof entrada !== 'object' || Array.isArray(entrada)) return { erro: 'Dados tributários inválidos.', campos: ['tributacao'] };
  const campos = [];
  const d = {};
  const txt = (v, max) => String(v ?? '').trim().slice(0, max);
  const digitos = (chave, n) => {
    if (ehVazio(entrada[chave])) return;
    const v = soDigitos(entrada[chave]);
    if (v.length !== n) campos.push(`tributacao.${chave}`); else d[chave] = v;
  };
  const percentual = (chave) => {
    if (ehVazio(entrada[chave])) return;
    const n = Number(String(entrada[chave]).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) campos.push(`tributacao.${chave}`); else d[chave] = Math.round(n * 10000) / 10000;
  };
  digitos('codigoMunicipio', 7);
  digitos('ncmPadrao', 8);
  digitos('cfopPadrao', 4);
  digitos('codigoTributacaoNacional', 6);
  if (!ehVazio(entrada.naturezaOperacao)) d.naturezaOperacao = txt(entrada.naturezaOperacao, 60);
  if (!ehVazio(entrada.icmsSituacao)) {
    const v = soDigitos(entrada.icmsSituacao);
    if (v.length < 2 || v.length > 3) campos.push('tributacao.icmsSituacao'); else d.icmsSituacao = v;
  }
  percentual('icmsAliquota');
  if (!ehVazio(entrada.pisCofinsSituacao)) {
    const v = soDigitos(entrada.pisCofinsSituacao);
    if (v.length !== 2) campos.push('tributacao.pisCofinsSituacao'); else d.pisCofinsSituacao = v;
  }
  if (!ehVazio(entrada.itemListaServico)) {
    const v = txt(entrada.itemListaServico, 10);
    if (!/^\d{1,2}\.?\d{2}$/.test(v)) campos.push('tributacao.itemListaServico'); else d.itemListaServico = v;
  }
  if (!ehVazio(entrada.codigoTributarioMunicipio)) d.codigoTributarioMunicipio = txt(entrada.codigoTributarioMunicipio, 20);
  percentual('aliquotaIss');
  if (entrada.issRetido !== undefined) d.issRetido = entrada.issRetido === true;
  if (entrada.ibsCbs !== undefined && entrada.ibsCbs !== null) {
    const ib = entrada.ibsCbs;
    if (typeof ib !== 'object') campos.push('tributacao.ibsCbs');
    else {
      const o = {};
      if (ib.incluir !== undefined) o.incluir = ib.incluir === true;
      if (!ehVazio(ib.cst)) { const v = soDigitos(ib.cst); if (v.length !== 3) campos.push('tributacao.ibsCbs.cst'); else o.cst = v; }
      if (!ehVazio(ib.cClassTrib)) { const v = soDigitos(ib.cClassTrib); if (v.length !== 6) campos.push('tributacao.ibsCbs.cClassTrib'); else o.cClassTrib = v; }
      d.ibsCbs = o;
    }
  }
  if (campos.length) return { erro: 'Confira os dados tributários destacados.', campos };
  return { dados: d };
}

module.exports = {
  normalizarTributacao,
  soDigitos,
  validarCnpj,
  validarCpf,
  validarDocumento,
  validarNcm,
  validarCfop,
  validarCest,
  validarUf,
  validarCep,
  resolverModoFiscal,
  conteudoCertificadoProibido,
  validarProntidaoProducao,
  UFS,
};

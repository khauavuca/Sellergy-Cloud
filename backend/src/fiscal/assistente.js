// Assistente "Ativar nota fiscal" — regras puras (o que falta em cada passo).
// Usa as validacoes de utils/validacaoFiscal.

const {
  soDigitos, validarCnpj, validarUf, validarCep,
} = require('../utils/validacaoFiscal');

const REGIMES = ['MEI', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real'];

/** O que o negocio emite: clinica = NFS-e, loja = NFC-e, os dois = ambas. */
function tiposPorSegmento(segmento) {
  const s = String(segmento || '').toUpperCase();
  if (s === 'SERVICO') return ['NFSE'];
  if (s === 'PRODUTO') return ['NFCE'];
  return ['NFSE', 'NFCE'];
}

const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** Valida e normaliza o passo Empresa. Retorna { erro, campos } ou { dados }. */
function validarEmpresa(corpo = {}) {
  const campos = [];
  const cnpj = soDigitos(corpo.cnpj);
  if (!validarCnpj(cnpj)) campos.push('cnpj');
  const razaoSocial = texto(corpo.razaoSocial).slice(0, 120);
  if (razaoSocial.length < 2) campos.push('razaoSocial');
  const regime = REGIMES.includes(texto(corpo.regime)) ? texto(corpo.regime) : null;
  if (!regime) campos.push('regime');
  const uf = texto(corpo.uf).toUpperCase();
  if (!uf || !validarUf(uf)) campos.push('uf');
  const cep = soDigitos(corpo.cep);
  if (!cep || !validarCep(cep)) campos.push('cep');
  const municipio = texto(corpo.municipio).slice(0, 80);
  if (municipio.length < 2) campos.push('municipio');
  const logradouro = texto(corpo.logradouro).slice(0, 120);
  if (logradouro.length < 2) campos.push('logradouro');
  const numero = texto(corpo.numero).slice(0, 20);
  if (!numero) campos.push('numero');
  const email = texto(corpo.emailEmitente).toLowerCase().slice(0, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) campos.push('emailEmitente');
  if (campos.length) return { erro: 'Confira os campos destacados.', campos };
  return {
    dados: {
      cnpj,
      razaoSocial,
      nomeFantasia: texto(corpo.nomeFantasia).slice(0, 120) || null,
      regime,
      inscricao: texto(corpo.inscricao).slice(0, 30).toUpperCase() || null,
      inscricaoMunicipal: texto(corpo.inscricaoMunicipal).slice(0, 30) || null,
      cnae: soDigitos(corpo.cnae).slice(0, 7) || null,
      emailEmitente: email || null,
      telefoneEmitente: soDigitos(corpo.telefoneEmitente).slice(0, 13) || null,
      logradouro,
      numero,
      complemento: texto(corpo.complemento).slice(0, 60) || null,
      bairro: texto(corpo.bairro).slice(0, 60) || null,
      municipio,
      uf,
      cep,
    },
  };
}

/** Valida o passo Configuracao (serie, proximo numero, CSC, emitir sozinho). */
function validarConfiguracao(corpo = {}, { tipos = ['NFSE', 'NFCE'] } = {}) {
  const campos = [];
  const serie = soDigitos(corpo.serie);
  if (!serie || Number(serie) < 1 || Number(serie) > 999) campos.push('serie');
  const proximo = Number(soDigitos(corpo.proximoNumero));
  if (!Number.isInteger(proximo) || proximo < 1 || proximo > 999999999) campos.push('proximoNumero');
  const csc = texto(corpo.csc).slice(0, 60);
  if (tipos.includes('NFCE') && csc.length < 16) campos.push('csc');
  // ID do CSC (Identificador do token): a SEFAZ mostra junto com o CSC, ex. 000001.
  const cscId = soDigitos(corpo.cscId).slice(0, 6);
  if (tipos.includes('NFCE') && !cscId) campos.push('cscId');
  if (campos.length) {
    return {
      erro: campos.includes('csc')
        ? 'O CSC (código da SEFAZ para NFC-e) tem pelo menos 16 caracteres.'
        : campos.includes('cscId') ? 'Informe o ID do CSC (o número que a SEFAZ mostra junto com o código, ex.: 000001).' : 'Confira os campos destacados.',
      campos,
    };
  }
  return {
    dados: {
      serie: String(Number(serie)),
      proximoNumero: proximo,
      csc: csc || null,
      cscId: cscId ? cscId.padStart(6, '0') : null,
      emitirAutomatico: corpo.emitirAutomatico === true,
    },
  };
}

/**
 * O que falta, por passo. Usado pela tela (bolinhas dos passos) e pra
 * liberar a nota de teste e a ativacao.
 */
function pendencias(config, {
  temCredencial = false, tipos = ['NFSE', 'NFCE'], agora = new Date(), emissaoReal = false,
} = {}) {
  const c = config || {};
  const empresa = [];
  if (!validarCnpj(c.cnpj)) empresa.push('CNPJ');
  if (!c.razaoSocial) empresa.push('razão social');
  if (!c.regime) empresa.push('regime');
  if (!c.logradouro || !c.numero || !c.municipio || !validarUf(c.uf) || !c.uf || !c.cep) empresa.push('endereço');
  if (tipos.includes('NFSE') && !c.inscricaoMunicipal) empresa.push('inscrição municipal');
  if (tipos.includes('NFCE') && !c.inscricao) empresa.push('inscrição estadual');

  const certificado = [];
  if (!c.certificadoRef) certificado.push('certificado A1');
  else if (c.certificadoValidoAte && new Date(c.certificadoValidoAte).getTime() <= agora.getTime()) certificado.push('certificado válido (o atual venceu)');
  // Gravado com FISCAL_LIVE desligado: o .pfx nunca chegou no emissor.
  else if (emissaoReal && String(c.certificadoRef).startsWith('simulado:')) certificado.push('reenviar o certificado A1 (o atual foi registrado em modo simulado)');

  const configuracao = [];
  if (!c.serie) configuracao.push('série');
  if (!c.proximoNumero) configuracao.push('próximo número');
  if (tipos.includes('NFCE') && !c.csc) configuracao.push('CSC da NFC-e');
  if (tipos.includes('NFCE') && c.csc && !c.cscId) configuracao.push('ID do CSC');

  const emissor = [];
  if (!temCredencial) emissor.push('emissor de notas liberado pela Sellergy');

  return {
    empresa,
    certificado,
    configuracao,
    emissor,
    prontoParaTeste: !empresa.length && !certificado.length && !configuracao.length && !emissor.length,
  };
}

/** Dias ate o certificado vencer (null se nao ha certificado). */
function diasParaVencer(validoAte, agora = new Date()) {
  if (!validoAte) return null;
  return Math.ceil((new Date(validoAte).getTime() - agora.getTime()) / 86400000);
}

module.exports = { REGIMES, tiposPorSegmento, validarEmpresa, validarConfiguracao, pendencias, diasParaVencer };

// Corpo real da nota (NFC-e e NFS-e) para Focus NFe e Nuvem Fiscal.
//
// Duas etapas, ambas PURAS (sem I/O, testaveis):
//   1. montarDadosNota(): junta config fiscal (emitente + tributacao), itens da
//      venda, destinatario e pagamento num formato neutro e lista o que falta
//      ("produto X sem NCM", "codigo IBGE do municipio"...).
//   2. corpoFocusNFCe / corpoFocusNFSe / corpoNuvemNFCe / corpoNuvemNFSe:
//      traduzem para o JSON de cada emissor e acrescentam o que falta
//      especifico daquele emissor.
//
// O adapter so chama a rede se a lista do que falta estiver vazia (modo live).
//
// IBS/CBS (reforma tributaria, LC 214/2025): grupo por item na NFC-e e grupo
// IBSCBS na DPS da NFS-e. Liga conforme FISCAL_IBS_CBS:
//   'auto' (padrao) -> so regime normal (Lucro Presumido/Real); Simples e MEI
//                      ficam de fora enquanto for opcional para eles
//   'sempre' | 'nunca'
// e pode ser forcado por empresa em tributacao.ibsCbs.incluir. Aliquotas de
// teste de 2026 por padrao (CBS 0,9%, IBS UF 0,1%, IBS municipio 0%),
// ajustaveis por FISCAL_ALIQUOTA_CBS / FISCAL_ALIQUOTA_IBS_UF / FISCAL_ALIQUOTA_IBS_MUN.
//
// ATENCAO: os nomes de campo seguem a documentacao publica dos emissores ate
// 06/2026. Os campos de IBS/CBS da Focus e o grupo IBSCBS da DPS ainda mudam
// por nota tecnica: conferir em homologacao antes de ligar em producao.

const { soDigitos, validarCnpj, validarCpf } = require('../../utils/validacaoFiscal');

const COD_UF = Object.freeze({
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23',
  RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
});

// Venda.metodoPagamento -> tPag (tabela da NF-e/NFC-e).
const FORMA_PAGAMENTO = Object.freeze({
  DINHEIRO: '01', CREDITO: '03', DEBITO: '04', BOLETO: '15', PIX: '17',
});

const HOMOLOGACAO_XPROD = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

const arred = (n) => Math.round(Number(n || 0) * 100) / 100;
const ehSimples = (regime) => /simples|mei/i.test(String(regime || ''));
const ehMei = (regime) => /^mei$/i.test(String(regime || '').trim());

/** 'YYYY-MM-DDTHH:mm:ss-03:00' no horario de Brasilia. */
function dataHoraBrasilia(agora = new Date()) {
  const local = new Date(agora.getTime() - 3 * 3600 * 1000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

function formaPagamento(metodo) {
  return FORMA_PAGAMENTO[String(metodo || '').toUpperCase()] || '99';
}

function aliquotaEnv(nome, padrao) {
  const bruto = process.env[nome];
  if (bruto === undefined || String(bruto).trim() === '') return padrao;
  const n = Number(String(bruto).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

/** Inclui o grupo IBS/CBS? (env FISCAL_IBS_CBS + override da empresa). */
function deveIncluirIbsCbs(config = {}) {
  const porEmpresa = config.tributacao?.ibsCbs?.incluir;
  if (porEmpresa === true || porEmpresa === false) return porEmpresa;
  const modo = String(process.env.FISCAL_IBS_CBS || 'auto').toLowerCase();
  if (modo === 'sempre') return true;
  if (modo === 'nunca') return false;
  return !ehSimples(config.regime);
}

function ibsCbsDe(config = {}) {
  if (!deveIncluirIbsCbs(config)) return null;
  const t = config.tributacao?.ibsCbs || {};
  return {
    cst: t.cst || '000',
    cClassTrib: t.cClassTrib || '000001',
    aliquotaCbs: aliquotaEnv('FISCAL_ALIQUOTA_CBS', 0.9),
    aliquotaIbsUf: aliquotaEnv('FISCAL_ALIQUOTA_IBS_UF', 0.1),
    aliquotaIbsMun: aliquotaEnv('FISCAL_ALIQUOTA_IBS_MUN', 0),
  };
}

/** Valores de IBS/CBS de uma base. */
function valoresIbsCbs(ib, base) {
  const vBC = arred(base);
  const vIBSUF = arred((vBC * ib.aliquotaIbsUf) / 100);
  const vIBSMun = arred((vBC * ib.aliquotaIbsMun) / 100);
  const vCBS = arred((vBC * ib.aliquotaCbs) / 100);
  return { vBC, vIBSUF, vIBSMun, vIBS: arred(vIBSUF + vIBSMun), vCBS };
}

/**
 * Formato neutro da nota + o que falta (comum aos dois emissores).
 * @param {Object} p
 * @param {'NFCE'|'NFSE'} p.tipo
 * @param {Object} p.config      ConfiguracaoFiscal (com tributacao JSON)
 * @param {Array}  [p.itens]     [{ produtoId, descricao, quantidade, valorUnitario, valorTotal, ncm, cfop, cest }]
 * @param {number} p.valor       total da nota
 * @param {string} [p.descricao] usada quando nao ha itens (nota pelo valor)
 * @param {Object} [p.destinatario] { nome, documento, email, uf, municipio }
 * @param {string} [p.formaPagamento] Venda.metodoPagamento (DINHEIRO, PIX...)
 * @param {number} [p.numero]    numero da nota/DPS (Nuvem Fiscal exige)
 */
function montarDadosNota({
  tipo, config = {}, itens = [], valor, descricao, destinatario = null, formaPagamento: metodo,
  numero = null, ambiente = 'homologacao', refExterna, agora = new Date(),
}) {
  const c = config || {};
  const t = c.tributacao && typeof c.tributacao === 'object' ? c.tributacao : {};
  const faltas = [];
  const simples = ehSimples(c.regime);

  const emitente = {
    cnpj: soDigitos(c.cnpj),
    ie: c.inscricao ? String(c.inscricao).replace(/[^0-9A-Za-z]/g, '') : null,
    im: c.inscricaoMunicipal ? String(c.inscricaoMunicipal).replace(/[^0-9A-Za-z]/g, '') : null,
    razaoSocial: c.razaoSocial || null,
    nomeFantasia: c.nomeFantasia || null,
    regime: c.regime || null,
    simples,
    crt: ehMei(c.regime) ? 4 : simples ? 1 : 3,
    uf: c.uf ? String(c.uf).toUpperCase() : null,
    codigoMunicipio: t.codigoMunicipio || null,
    email: c.emailEmitente || null,
    telefone: c.telefoneEmitente ? soDigitos(c.telefoneEmitente) : null,
    cnae: c.cnae ? soDigitos(c.cnae) : null,
    endereco: {
      logradouro: c.logradouro || null, numero: c.numero || null, complemento: c.complemento || null,
      bairro: c.bairro || null, municipio: c.municipio || null, uf: c.uf || null, cep: c.cep ? soDigitos(c.cep) : null,
    },
  };
  if (!validarCnpj(emitente.cnpj)) faltas.push('CNPJ do emitente válido');
  if (!emitente.razaoSocial) faltas.push('razão social do emitente');

  const listaItens = (Array.isArray(itens) && itens.length ? itens : [{
    descricao: descricao || (tipo === 'NFSE' ? 'Prestação de serviço' : 'Venda'),
    quantidade: 1, valorUnitario: Number(valor), valorTotal: Number(valor),
  }]).map((it, i) => {
    const quantidade = Number(it.quantidade) || 1;
    const valorTotal = arred(it.valorTotal ?? Number(it.valorUnitario || 0) * quantidade);
    return {
      numero: i + 1,
      codigo: String(it.variacaoId || it.produtoId || `ITEM${i + 1}`).replace(/-/g, '').slice(0, 60),
      descricao: String(it.descricao || `Item ${i + 1}`).slice(0, 120),
      quantidade,
      valorUnitario: arred(it.valorUnitario ?? valorTotal / quantidade),
      valorTotal,
      ncm: soDigitos(it.ncm) || t.ncmPadrao || null,
      cfop: soDigitos(it.cfop) || t.cfopPadrao || null,
      cest: soDigitos(it.cest) || null,
      unidade: 'UN',
    };
  });
  const valorTotal = arred(valor ?? listaItens.reduce((s, i) => s + i.valorTotal, 0));
  if (!(valorTotal > 0)) faltas.push('valor da nota maior que zero');

  let dest = null;
  if (destinatario && (destinatario.nome || destinatario.documento)) {
    const doc = soDigitos(destinatario.documento);
    dest = {
      nome: destinatario.nome ? String(destinatario.nome).slice(0, 60) : null,
      cpf: doc.length === 11 && validarCpf(doc) ? doc : null,
      cnpj: doc.length === 14 && validarCnpj(doc) ? doc : null,
      email: destinatario.email || null,
      uf: destinatario.uf || null,
      municipio: destinatario.municipio || null,
    };
  }

  const dados = {
    tipo,
    ref: refExterna,
    ambiente,
    dataEmissao: dataHoraBrasilia(agora),
    competencia: dataHoraBrasilia(agora).slice(0, 10),
    emitente,
    destinatario: dest,
    itens: listaItens,
    valorTotal,
    pagamentos: [{ forma: formaPagamento(metodo), valor: valorTotal }],
    serie: c.serie ? String(Number(c.serie) || 1) : '1',
    numero: numero ? Number(numero) : null,
    ibsCbs: ibsCbsDe(c),
  };

  if (tipo === 'NFCE') {
    dados.naturezaOperacao = t.naturezaOperacao || 'Venda ao consumidor';
    dados.icms = {
      situacao: t.icmsSituacao || (simples ? '102' : null),
      aliquota: t.icmsAliquota ?? null,
    };
    dados.pisCofinsSituacao = t.pisCofinsSituacao || (simples ? '49' : null);
    if (!emitente.ie) faltas.push('inscrição estadual do emitente');
    if (!dados.icms.situacao) faltas.push('CST do ICMS (regime normal) nos dados tributários');
    if (!simples && dados.icms.situacao === '00' && dados.icms.aliquota === null) faltas.push('alíquota do ICMS nos dados tributários');
    if (!dados.pisCofinsSituacao) faltas.push('CST de PIS/COFINS (regime normal) nos dados tributários');
    for (const it of listaItens) {
      if (!it.ncm || it.ncm.length !== 8) faltas.push(`produto "${it.descricao}" sem NCM`);
      if (!it.cfop || it.cfop.length !== 4) faltas.push(`produto "${it.descricao}" sem CFOP`);
    }
  } else {
    dados.servico = {
      discriminacao: listaItens.map((i) => (i.quantidade !== 1 ? `${i.quantidade} x ${i.descricao}` : i.descricao)).join('; ').slice(0, 2000),
      itemListaServico: t.itemListaServico || null,
      codigoTributacaoNacional: t.codigoTributacaoNacional || null,
      codigoTributarioMunicipio: t.codigoTributarioMunicipio || null,
      aliquotaIss: t.aliquotaIss ?? null,
      issRetido: t.issRetido === true,
      cnae: emitente.cnae,
    };
    if (!emitente.im) faltas.push('inscrição municipal do emitente');
    if (!emitente.codigoMunicipio) faltas.push('código IBGE do município do emitente nos dados tributários');
  }
  return { dados, faltas };
}

// ---------------------------------------------------------------------------
// Focus NFe (https://focusnfe.com.br/doc/)
// ---------------------------------------------------------------------------

function focusIbsCbsItem(ib, base) {
  if (!ib) return {};
  const v = valoresIbsCbs(ib, base);
  return {
    ibs_cbs_situacao_tributaria: ib.cst,
    ibs_cbs_classificacao_tributaria: ib.cClassTrib,
    ibs_cbs_base_calculo: v.vBC,
    ibs_uf_aliquota: ib.aliquotaIbsUf,
    ibs_uf_valor: v.vIBSUF,
    ibs_mun_aliquota: ib.aliquotaIbsMun,
    ibs_mun_valor: v.vIBSMun,
    cbs_aliquota: ib.aliquotaCbs,
    cbs_valor: v.vCBS,
  };
}

function corpoFocusNFCe(d) {
  const faltas = [];
  const corpo = {
    natureza_operacao: d.naturezaOperacao,
    data_emissao: d.dataEmissao,
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: 1,
    presenca_comprador: 1,
    local_destino: 1,
    modalidade_frete: 9,
    cnpj_emitente: d.emitente.cnpj,
    items: d.itens.map((it) => ({
      numero_item: it.numero,
      codigo_produto: it.codigo,
      descricao: it.descricao,
      codigo_ncm: it.ncm,
      cfop: it.cfop,
      ...(it.cest ? { cest: it.cest } : {}),
      unidade_comercial: it.unidade,
      quantidade_comercial: it.quantidade,
      valor_unitario_comercial: it.valorUnitario,
      unidade_tributavel: it.unidade,
      quantidade_tributavel: it.quantidade,
      valor_unitario_tributavel: it.valorUnitario,
      valor_bruto: it.valorTotal,
      inclui_no_total: 1,
      icms_origem: 0,
      icms_situacao_tributaria: d.icms.situacao,
      ...(d.icms.situacao === '00' ? { icms_modalidade_base_calculo: 3, icms_base_calculo: it.valorTotal, icms_aliquota: d.icms.aliquota } : {}),
      pis_situacao_tributaria: d.pisCofinsSituacao,
      cofins_situacao_tributaria: d.pisCofinsSituacao,
      ...focusIbsCbsItem(d.ibsCbs, it.valorTotal),
    })),
    formas_pagamento: d.pagamentos.map((p) => ({
      forma_pagamento: p.forma,
      valor_pagamento: p.valor,
      ...(p.forma === '03' || p.forma === '04' ? { tipo_integracao: 2 } : {}),
    })),
  };
  if (d.destinatario?.nome) corpo.nome_destinatario = d.destinatario.nome;
  if (d.destinatario?.cpf) corpo.cpf_destinatario = d.destinatario.cpf;
  if (d.destinatario?.cnpj) corpo.cnpj_destinatario = d.destinatario.cnpj;
  if (d.destinatario) corpo.indicador_inscricao_estadual_destinatario = 9;
  return { corpo, faltas };
}

function corpoFocusNFSe(d) {
  const faltas = [];
  const s = d.servico;
  if (!s.itemListaServico && !s.codigoTributarioMunicipio) faltas.push('item da lista de serviço (LC 116) ou código de serviço do município nos dados tributários');
  const tomador = d.destinatario ? {
    ...(d.destinatario.cpf ? { cpf: d.destinatario.cpf } : {}),
    ...(d.destinatario.cnpj ? { cnpj: d.destinatario.cnpj } : {}),
    ...(d.destinatario.nome ? { razao_social: d.destinatario.nome } : {}),
    ...(d.destinatario.email ? { email: d.destinatario.email } : {}),
  } : null;
  const corpo = {
    data_emissao: d.dataEmissao,
    natureza_operacao: '1', // tributacao no municipio
    optante_simples_nacional: d.emitente.simples,
    prestador: {
      cnpj: d.emitente.cnpj,
      inscricao_municipal: d.emitente.im,
      codigo_municipio: d.emitente.codigoMunicipio,
    },
    ...(tomador && Object.keys(tomador).length ? { tomador } : {}),
    servico: {
      valor_servicos: d.valorTotal,
      discriminacao: s.discriminacao,
      iss_retido: s.issRetido,
      ...(s.itemListaServico ? { item_lista_servico: s.itemListaServico } : {}),
      ...(s.codigoTributarioMunicipio ? { codigo_tributario_municipio: s.codigoTributarioMunicipio } : {}),
      ...(s.aliquotaIss !== null ? { aliquota: s.aliquotaIss } : {}),
      ...(s.cnae ? { codigo_cnae: s.cnae } : {}),
      ...(d.ibsCbs ? (() => {
        const v = valoresIbsCbs(d.ibsCbs, d.valorTotal);
        return {
          ibs_cbs_situacao_tributaria: d.ibsCbs.cst,
          ibs_cbs_classificacao_tributaria: d.ibsCbs.cClassTrib,
          ibs_cbs_base_calculo: v.vBC,
          ibs_uf_aliquota: d.ibsCbs.aliquotaIbsUf,
          ibs_mun_aliquota: d.ibsCbs.aliquotaIbsMun,
          cbs_aliquota: d.ibsCbs.aliquotaCbs,
        };
      })() : {}),
    },
  };
  return { corpo, faltas };
}

// ---------------------------------------------------------------------------
// Nuvem Fiscal (https://dev.nuvemfiscal.com.br/docs/api) — JSON no layout da SEFAZ
// ---------------------------------------------------------------------------

function nuvemImpostoItem(d, it) {
  const sit = d.icms.situacao;
  let ICMS;
  if (d.emitente.simples) ICMS = { [`ICMSSN${sit}`]: { orig: 0, CSOSN: sit } };
  else if (sit === '00') {
    ICMS = { ICMS00: { orig: 0, CST: '00', modBC: 3, vBC: it.valorTotal, pICMS: d.icms.aliquota, vICMS: arred((it.valorTotal * Number(d.icms.aliquota || 0)) / 100) } };
  } else ICMS = { [`ICMS${sit}`]: { orig: 0, CST: sit } };
  const imposto = {
    ICMS,
    PIS: { PISOutr: { CST: d.pisCofinsSituacao, vBC: 0, pPIS: 0, vPIS: 0 } },
    COFINS: { COFINSOutr: { CST: d.pisCofinsSituacao, vBC: 0, pCOFINS: 0, vCOFINS: 0 } },
  };
  if (d.ibsCbs) {
    const v = valoresIbsCbs(d.ibsCbs, it.valorTotal);
    imposto.IBSCBS = {
      CST: d.ibsCbs.cst,
      cClassTrib: d.ibsCbs.cClassTrib,
      gIBSCBS: {
        vBC: v.vBC,
        gIBSUF: { pIBSUF: d.ibsCbs.aliquotaIbsUf, vIBSUF: v.vIBSUF },
        gIBSMun: { pIBSMun: d.ibsCbs.aliquotaIbsMun, vIBSMun: v.vIBSMun },
        vIBS: v.vIBS,
        gCBS: { pCBS: d.ibsCbs.aliquotaCbs, vCBS: v.vCBS },
      },
    };
  }
  return imposto;
}

function faltasNuvem(d) {
  const faltas = [];
  if (!d.emitente.codigoMunicipio) faltas.push('código IBGE do município do emitente nos dados tributários');
  if (!d.emitente.uf || !COD_UF[d.emitente.uf]) faltas.push('UF do emitente');
  if (!d.numero) faltas.push('próximo número da nota (passo Configuração do assistente)');
  return faltas;
}

function corpoNuvemNFCe(d) {
  const faltas = faltasNuvem(d);
  const tpAmb = d.ambiente === 'producao' ? 1 : 2;
  const vProd = arred(d.itens.reduce((s, i) => s + i.valorTotal, 0));
  const vICMS = d.icms.situacao === '00' && !d.emitente.simples
    ? arred(d.itens.reduce((s, i) => s + (i.valorTotal * Number(d.icms.aliquota || 0)) / 100, 0)) : 0;
  const det = d.itens.map((it, idx) => ({
    nItem: it.numero,
    prod: {
      cProd: it.codigo,
      cEAN: 'SEM GTIN',
      // SEFAZ exige este texto no 1o item em homologacao.
      xProd: tpAmb === 2 && idx === 0 ? HOMOLOGACAO_XPROD : it.descricao,
      NCM: it.ncm,
      ...(it.cest ? { CEST: it.cest } : {}),
      CFOP: it.cfop,
      uCom: it.unidade,
      qCom: it.quantidade,
      vUnCom: it.valorUnitario,
      vProd: it.valorTotal,
      cEANTrib: 'SEM GTIN',
      uTrib: it.unidade,
      qTrib: it.quantidade,
      vUnTrib: it.valorUnitario,
      indTot: 1,
    },
    imposto: nuvemImpostoItem(d, it),
  }));
  const total = {
    ICMSTot: {
      vBC: vICMS ? vProd : 0, vICMS, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vFCPSTRet: 0,
      vProd, vFrete: 0, vSeg: 0, vDesc: 0, vII: 0, vIPI: 0, vIPIDevol: 0, vPIS: 0, vCOFINS: 0, vOutro: 0, vNF: d.valorTotal,
    },
  };
  if (d.ibsCbs) {
    const v = valoresIbsCbs(d.ibsCbs, vProd);
    total.IBSCBSTot = {
      vBCIBSCBS: v.vBC,
      gIBS: { gIBSUF: { vIBSUF: v.vIBSUF }, gIBSMun: { vIBSMun: v.vIBSMun }, vIBS: v.vIBS },
      gCBS: { vCBS: v.vCBS },
    };
  }
  const dest = d.destinatario && (d.destinatario.cpf || d.destinatario.cnpj) ? {
    ...(d.destinatario.cpf ? { CPF: d.destinatario.cpf } : { CNPJ: d.destinatario.cnpj }),
    ...(d.destinatario.nome ? { xNome: d.destinatario.nome } : {}),
    indIEDest: 9,
  } : undefined;
  const corpo = {
    ambiente: d.ambiente === 'producao' ? 'producao' : 'homologacao',
    referencia: d.ref,
    infNFe: {
      versao: '4.00',
      ide: {
        cUF: Number(COD_UF[d.emitente.uf] || 0),
        natOp: d.naturezaOperacao,
        mod: 65,
        serie: Number(d.serie),
        nNF: d.numero,
        dhEmi: d.dataEmissao,
        tpNF: 1,
        idDest: 1,
        cMunFG: d.emitente.codigoMunicipio,
        tpImp: 4,
        tpEmis: 1,
        tpAmb,
        finNFe: 1,
        indFinal: 1,
        indPres: 1,
        procEmi: 0,
        verProc: 'Sellergy',
      },
      emit: { CNPJ: d.emitente.cnpj, IE: d.emitente.ie, CRT: d.emitente.crt },
      ...(dest ? { dest } : {}),
      det,
      total,
      transp: { modFrete: 9 },
      pag: {
        detPag: d.pagamentos.map((p) => ({
          tPag: p.forma,
          vPag: p.valor,
          ...(p.forma === '03' || p.forma === '04' ? { card: { tpIntegra: 2 } } : {}),
        })),
      },
    },
  };
  return { corpo, faltas };
}

function corpoNuvemNFSe(d) {
  const faltas = faltasNuvem(d);
  const s = d.servico;
  if (!s.codigoTributacaoNacional) faltas.push('código de tributação nacional do serviço (cTribNac, 6 dígitos) nos dados tributários');
  const tpAmb = d.ambiente === 'producao' ? 1 : 2;
  const opSimpNac = ehMei(d.emitente.regime) ? 2 : d.emitente.simples ? 3 : 1;
  const toma = d.destinatario && (d.destinatario.cpf || d.destinatario.cnpj) ? {
    ...(d.destinatario.cpf ? { CPF: d.destinatario.cpf } : { CNPJ: d.destinatario.cnpj }),
    xNome: d.destinatario.nome || 'Consumidor',
    ...(d.destinatario.email ? { email: d.destinatario.email } : {}),
  } : undefined;
  const infDPS = {
    tpAmb,
    dhEmi: d.dataEmissao,
    verAplic: 'Sellergy',
    serie: String(d.serie),
    nDPS: String(d.numero || ''),
    dCompet: d.competencia,
    tpEmit: 1,
    cLocEmi: d.emitente.codigoMunicipio,
    prest: {
      CNPJ: d.emitente.cnpj,
      ...(d.emitente.im ? { IM: d.emitente.im } : {}),
      ...(d.emitente.email ? { email: d.emitente.email } : {}),
      regTrib: { opSimpNac, regEspTrib: 0 },
    },
    ...(toma ? { toma } : {}),
    serv: {
      locPrest: { cLocPrestacao: d.emitente.codigoMunicipio },
      cServ: {
        cTribNac: s.codigoTributacaoNacional,
        ...(s.codigoTributarioMunicipio ? { cTribMun: s.codigoTributarioMunicipio } : {}),
        xDescServ: s.discriminacao,
      },
    },
    valores: {
      vServPrest: { vServ: d.valorTotal },
      trib: {
        tribMun: {
          tribISSQN: 1,
          tpRetISSQN: s.issRetido ? 2 : 1,
          ...(s.aliquotaIss !== null && !d.emitente.simples ? { pAliq: s.aliquotaIss } : {}),
        },
        totTrib: { indTotTrib: 0 },
      },
    },
  };
  if (d.ibsCbs) {
    infDPS.IBSCBS = {
      finNFSe: 0,
      indFinal: 1,
      cIndOp: '100301', // indicador da operacao (NT NFS-e/IBS-CBS): conferir em homologacao
      indDest: 0,
      valores: { trib: { gIBSCBS: { CST: d.ibsCbs.cst, cClassTrib: d.ibsCbs.cClassTrib } } },
    };
  }
  const corpo = {
    provedor: 'padrao',
    ambiente: d.ambiente === 'producao' ? 'producao' : 'homologacao',
    referencia: d.ref,
    infDPS,
  };
  return { corpo, faltas };
}

module.exports = {
  COD_UF,
  FORMA_PAGAMENTO,
  HOMOLOGACAO_XPROD,
  dataHoraBrasilia,
  formaPagamento,
  deveIncluirIbsCbs,
  valoresIbsCbs,
  montarDadosNota,
  corpoFocusNFCe,
  corpoFocusNFSe,
  corpoNuvemNFCe,
  corpoNuvemNFSe,
};

const test = require('node:test');
const assert = require('node:assert');
const {
  montarDadosNota, corpoFocusNFCe, corpoFocusNFSe, corpoNuvemNFCe, corpoNuvemNFSe,
  deveIncluirIbsCbs, formaPagamento, dataHoraBrasilia,
} = require('./corpoNota');
const FocusNFeAdapter = require('./focusNFe');
const NuvemFiscalAdapter = require('./nuvemFiscal');
const { mensagemDoEmissor } = require('./ProvedorFiscal');

const CONFIG = {
  provedor: 'FOCUS_NFE', cnpj: '11222333000181', razaoSocial: 'Lumi Estética Ltda', regime: 'Simples Nacional',
  inscricao: '123456789', inscricaoMunicipal: '9876', uf: 'SP', municipio: 'São Paulo', logradouro: 'Av. Paulista',
  numero: '1000', cep: '01310100', serie: '1', proximoNumero: 10,
  tributacao: {
    codigoMunicipio: '3550308', itemListaServico: '06.01', codigoTributacaoNacional: '060101', aliquotaIss: 2,
  },
};
const ITENS = [
  { produtoId: 'p1', variacaoId: 'v1', descricao: 'Shampoo', quantidade: 2, valorUnitario: 10, valorTotal: 20, ncm: '33051000', cfop: '5102' },
  { produtoId: 'p2', variacaoId: 'v2', descricao: 'Condicionador', quantidade: 1, valorUnitario: 15, valorTotal: 15 },
];

function semIbsCbsEnv(fn) {
  const antes = process.env.FISCAL_IBS_CBS;
  return async () => {
    delete process.env.FISCAL_IBS_CBS;
    try { await fn(); } finally { if (antes === undefined) delete process.env.FISCAL_IBS_CBS; else process.env.FISCAL_IBS_CBS = antes; }
  };
}

test('NFC-e: item sem NCM/CFOP vira falta clara com o nome do produto', () => {
  const { faltas, dados } = montarDadosNota({ tipo: 'NFCE', config: CONFIG, itens: ITENS, valor: 35, refExterna: 'd1', formaPagamento: 'PIX' });
  assert.ok(faltas.includes('produto "Condicionador" sem NCM'));
  assert.ok(faltas.includes('produto "Condicionador" sem CFOP'));
  assert.ok(!faltas.some((f) => f.includes('Shampoo')));
  assert.strictEqual(dados.pagamentos[0].forma, '17');
  assert.strictEqual(dados.valorTotal, 35);
});

test('NFC-e: NCM/CFOP padrao da empresa completam item sem codigo', () => {
  const config = { ...CONFIG, tributacao: { ...CONFIG.tributacao, ncmPadrao: '33059000', cfopPadrao: '5102' } };
  const { faltas, dados } = montarDadosNota({ tipo: 'NFCE', config, itens: ITENS, valor: 35, refExterna: 'd1' });
  assert.deepStrictEqual(faltas, []);
  assert.strictEqual(dados.itens[1].ncm, '33059000');
});

test('regime normal exige CST de ICMS e PIS/COFINS; Simples usa 102/49', () => {
  const normal = montarDadosNota({ tipo: 'NFCE', config: { ...CONFIG, regime: 'Lucro Presumido' }, itens: [ITENS[0]], valor: 20 });
  assert.ok(normal.faltas.some((f) => f.includes('CST do ICMS')));
  assert.ok(normal.faltas.some((f) => f.includes('PIS/COFINS')));
  const simples = montarDadosNota({ tipo: 'NFCE', config: CONFIG, itens: [ITENS[0]], valor: 20 });
  assert.strictEqual(simples.dados.icms.situacao, '102');
  assert.strictEqual(simples.dados.pisCofinsSituacao, '49');
  assert.strictEqual(simples.dados.emitente.crt, 1);
});

test('NFS-e: sem inscricao municipal e codigo IBGE lista o que falta', () => {
  const config = { ...CONFIG, inscricaoMunicipal: null, tributacao: {} };
  const { faltas } = montarDadosNota({ tipo: 'NFSE', config, valor: 100, descricao: 'Limpeza de pele' });
  assert.ok(faltas.includes('inscrição municipal do emitente'));
  assert.ok(faltas.some((f) => f.includes('código IBGE')));
  const focus = corpoFocusNFSe(montarDadosNota({ tipo: 'NFSE', config, valor: 100 }).dados);
  assert.ok(focus.faltas.some((f) => f.includes('item da lista de serviço')));
});

test('corpo Focus NFC-e tem itens, NCM, CFOP, pagamento e emitente', semIbsCbsEnv(() => {
  const config = { ...CONFIG, tributacao: { ...CONFIG.tributacao, cfopPadrao: '5102', ncmPadrao: '33059000' } };
  const { dados } = montarDadosNota({
    tipo: 'NFCE', config, itens: ITENS, valor: 35, formaPagamento: 'CREDITO',
    destinatario: { nome: 'Ana', documento: '529.982.247-25' },
  });
  const { corpo, faltas } = corpoFocusNFCe(dados);
  assert.deepStrictEqual(faltas, []);
  assert.strictEqual(corpo.cnpj_emitente, '11222333000181');
  assert.strictEqual(corpo.natureza_operacao, 'Venda ao consumidor');
  assert.strictEqual(corpo.items.length, 2);
  assert.strictEqual(corpo.items[0].codigo_ncm, '33051000');
  assert.strictEqual(corpo.items[0].quantidade_comercial, 2);
  assert.strictEqual(corpo.items[0].valor_bruto, 20);
  assert.strictEqual(corpo.items[0].icms_situacao_tributaria, '102');
  assert.deepStrictEqual(corpo.formas_pagamento, [{ forma_pagamento: '03', valor_pagamento: 35, tipo_integracao: 2 }]);
  assert.strictEqual(corpo.cpf_destinatario, '52998224725');
  // Simples Nacional: IBS/CBS fica de fora no modo 'auto'.
  assert.strictEqual(corpo.items[0].cbs_aliquota, undefined);
}));

test('IBS/CBS: auto liga para regime normal; env e empresa podem forcar', semIbsCbsEnv(() => {
  assert.strictEqual(deveIncluirIbsCbs({ regime: 'Simples Nacional' }), false);
  assert.strictEqual(deveIncluirIbsCbs({ regime: 'Lucro Real' }), true);
  assert.strictEqual(deveIncluirIbsCbs({ regime: 'Lucro Real', tributacao: { ibsCbs: { incluir: false } } }), false);
  process.env.FISCAL_IBS_CBS = 'sempre';
  assert.strictEqual(deveIncluirIbsCbs({ regime: 'MEI' }), true);
  process.env.FISCAL_IBS_CBS = 'nunca';
  assert.strictEqual(deveIncluirIbsCbs({ regime: 'Lucro Real' }), false);
}));

test('IBS/CBS no corpo Focus e Nuvem com aliquotas de teste de 2026', semIbsCbsEnv(() => {
  const config = {
    ...CONFIG, regime: 'Lucro Presumido',
    tributacao: { ...CONFIG.tributacao, icmsSituacao: '00', icmsAliquota: 18, pisCofinsSituacao: '01' },
  };
  const { dados, faltas } = montarDadosNota({ tipo: 'NFCE', config, itens: [ITENS[0]], valor: 20, numero: 10 });
  assert.deepStrictEqual(faltas, []);
  const focus = corpoFocusNFCe(dados).corpo.items[0];
  assert.strictEqual(focus.ibs_cbs_situacao_tributaria, '000');
  assert.strictEqual(focus.ibs_cbs_classificacao_tributaria, '000001');
  assert.strictEqual(focus.cbs_aliquota, 0.9);
  assert.strictEqual(focus.cbs_valor, 0.18);
  assert.strictEqual(focus.ibs_uf_valor, 0.02);
  const nuvem = corpoNuvemNFCe(dados).corpo.infNFe;
  assert.strictEqual(nuvem.det[0].imposto.IBSCBS.gIBSCBS.gCBS.vCBS, 0.18);
  assert.strictEqual(nuvem.total.IBSCBSTot.gCBS.vCBS, 0.18);
  assert.strictEqual(nuvem.det[0].imposto.ICMS.ICMS00.vICMS, 3.6);
}));

test('corpo Nuvem NFC-e: layout SEFAZ, sandbox marca homologacao no 1o item', semIbsCbsEnv(() => {
  const { dados } = montarDadosNota({ tipo: 'NFCE', config: CONFIG, itens: [ITENS[0]], valor: 20, numero: 10, refExterna: 'doc-1' });
  const { corpo, faltas } = corpoNuvemNFCe(dados);
  assert.deepStrictEqual(faltas, []);
  assert.strictEqual(corpo.ambiente, 'homologacao');
  assert.strictEqual(corpo.referencia, 'doc-1');
  assert.strictEqual(corpo.infNFe.ide.mod, 65);
  assert.strictEqual(corpo.infNFe.ide.cUF, 35);
  assert.strictEqual(corpo.infNFe.ide.nNF, 10);
  assert.strictEqual(corpo.infNFe.ide.tpAmb, 2);
  assert.strictEqual(corpo.infNFe.det[0].prod.NCM, '33051000');
  assert.match(corpo.infNFe.det[0].prod.xProd, /HOMOLOGACAO/);
  assert.deepStrictEqual(corpo.infNFe.det[0].imposto.ICMS, { ICMSSN102: { orig: 0, CSOSN: '102' } });
  assert.strictEqual(corpo.infNFe.total.ICMSTot.vNF, 20);
  // Sem numero a Nuvem nao aceita: falta clara.
  const semNumero = corpoNuvemNFCe(montarDadosNota({ tipo: 'NFCE', config: CONFIG, itens: [ITENS[0]], valor: 20 }).dados);
  assert.ok(semNumero.faltas.some((f) => f.includes('próximo número')));
}));

test('corpo Nuvem NFS-e (DPS) e Focus NFS-e com prestador, tomador e servico', semIbsCbsEnv(() => {
  const { dados, faltas } = montarDadosNota({
    tipo: 'NFSE', config: CONFIG, valor: 150, numero: 7,
    itens: [{ descricao: 'Limpeza de pele', quantidade: 1, valorUnitario: 150, valorTotal: 150 }],
    destinatario: { nome: 'Ana', documento: '52998224725', email: 'ana@exemplo.com' },
  });
  assert.deepStrictEqual(faltas, []);
  const nuvem = corpoNuvemNFSe(dados);
  assert.deepStrictEqual(nuvem.faltas, []);
  assert.strictEqual(nuvem.corpo.infDPS.serv.cServ.cTribNac, '060101');
  assert.strictEqual(nuvem.corpo.infDPS.valores.vServPrest.vServ, 150);
  assert.strictEqual(nuvem.corpo.infDPS.prest.regTrib.opSimpNac, 3);
  assert.strictEqual(nuvem.corpo.infDPS.toma.CPF, '52998224725');
  const focus = corpoFocusNFSe(dados);
  assert.deepStrictEqual(focus.faltas, []);
  assert.deepStrictEqual(focus.corpo.prestador, { cnpj: '11222333000181', inscricao_municipal: '9876', codigo_municipio: '3550308' });
  assert.strictEqual(focus.corpo.servico.item_lista_servico, '06.01');
  assert.strictEqual(focus.corpo.servico.discriminacao, 'Limpeza de pele');
  assert.strictEqual(focus.corpo.tomador.cpf, '52998224725');
}));

test('forma de pagamento da venda vira tPag; data no fuso de Brasilia', () => {
  assert.strictEqual(formaPagamento('DINHEIRO'), '01');
  assert.strictEqual(formaPagamento('DEBITO'), '04');
  assert.strictEqual(formaPagamento('BOLETO'), '15');
  assert.strictEqual(formaPagamento('qualquer'), '99');
  assert.strictEqual(dataHoraBrasilia(new Date('2026-08-01T15:00:00Z')), '2026-08-01T12:00:00-03:00');
});

// --------------------------- adapters: rota por tipo ------------------------

function capturar(adapter) {
  const reqs = [];
  adapter._executar = async (req, fixture) => { reqs.push(req); return fixture(); };
  return reqs;
}

test('Focus: NFS-e consulta e cancela em /v2/nfse, NFC-e em /v2/nfce', async () => {
  const a = new FocusNFeAdapter({ credencial: { dados: { token: 't' } }, config: CONFIG, ambiente: 'homologacao', modo: 'fixture' });
  const reqs = capturar(a);
  await a.consultarStatus('doc-1', 'NFSE');
  await a.cancelar('doc-1', 'Motivo do cancelamento longo', 'NFSE');
  await a.consultarStatus('doc-2', 'NFCE');
  await a.cancelar('doc-2', 'Motivo do cancelamento longo', 'NFCE');
  assert.strictEqual(reqs[0].url, 'https://homologacao.focusnfe.com.br/v2/nfse/doc-1');
  assert.strictEqual(reqs[1].url, 'https://homologacao.focusnfe.com.br/v2/nfse/doc-1');
  assert.strictEqual(reqs[1].metodo, 'DELETE');
  assert.strictEqual(reqs[2].url, 'https://homologacao.focusnfe.com.br/v2/nfce/doc-2');
  assert.strictEqual(reqs[3].url, 'https://homologacao.focusnfe.com.br/v2/nfce/doc-2');
});

test('Focus: emissao manda o corpo real (nao so valor/descricao)', async () => {
  const config = { ...CONFIG, tributacao: { ...CONFIG.tributacao, ncmPadrao: '33059000', cfopPadrao: '5102' } };
  const a = new FocusNFeAdapter({ credencial: { dados: { token: 't' } }, config, ambiente: 'producao', modo: 'fixture' });
  const reqs = capturar(a);
  await a.emitirNFCe({ valor: 35, refExterna: 'doc-9', itens: ITENS, formaPagamento: 'PIX' });
  assert.strictEqual(reqs[0].url, 'https://api.focusnfe.com.br/v2/nfce?ref=doc-9');
  assert.strictEqual(reqs[0].corpo.items.length, 2);
  assert.strictEqual(reqs[0].corpo.valor_total, undefined);
});

test('Nuvem: homologacao usa o sandbox (igual ao certificado); rotas por tipo', async () => {
  const a = new NuvemFiscalAdapter({ credencial: { dados: { accessToken: 't' } }, config: CONFIG, ambiente: 'homologacao', modo: 'fixture' });
  assert.strictEqual(NuvemFiscalAdapter.baseUrl('homologacao'), 'https://api.sandbox.nuvemfiscal.com.br');
  assert.strictEqual(NuvemFiscalAdapter.baseUrl('producao'), 'https://api.nuvemfiscal.com.br');
  const reqs = [];
  a._executar = async (req, fixture) => { reqs.push(req); return fixture(); };
  a.modo = 'live'; // so para passar pelo _chamar; _executar esta trocado (sem rede)
  await a.emitirNFSe({ valor: 150, refExterna: 'd1', numero: 1, descricao: 'Serviço' });
  await a.consultarStatus('nf1', 'NFSE');
  await a.cancelar('nf1', 'Motivo do cancelamento longo', 'NFSE');
  await a.consultarStatus('nf2', 'NFCE');
  await a.cancelar('nf2', 'Motivo do cancelamento longo', 'NFCE');
  assert.deepStrictEqual(reqs.map((r) => r.url), [
    'https://api.sandbox.nuvemfiscal.com.br/nfse/dps',
    'https://api.sandbox.nuvemfiscal.com.br/nfse/nf1',
    'https://api.sandbox.nuvemfiscal.com.br/nfse/nf1/cancelamento',
    'https://api.sandbox.nuvemfiscal.com.br/nfce/nf2',
    'https://api.sandbox.nuvemfiscal.com.br/nfce/nf2/cancelamento',
  ]);
  assert.strictEqual(reqs[0].headers.Authorization, 'Bearer t');
});

test('modo live bloqueia emissao incompleta ANTES de chamar o emissor', async () => {
  const a = new FocusNFeAdapter({ credencial: { dados: { token: 't' } }, config: CONFIG, ambiente: 'producao', modo: 'live' });
  let chamou = false;
  a._executar = async () => { chamou = true; return {}; };
  await assert.rejects(() => a.emitirNFCe({ valor: 35, refExterna: 'x', itens: ITENS }), (e) => {
    assert.strictEqual(e.status, 422);
    assert.match(e.message, /produto "Condicionador" sem NCM/);
    return true;
  });
  assert.strictEqual(chamou, false);
});

test('Nuvem OAuth: token em cache, renovado perto de vencer e apos 401', async () => {
  NuvemFiscalAdapter.limparCacheTokens();
  let pedidos = 0;
  const buscar = async (_url, opts) => {
    pedidos += 1;
    assert.match(opts.body, /grant_type=client_credentials/);
    return { ok: true, json: async () => ({ access_token: `tok${pedidos}`, expires_in: 3600 }) };
  };
  const cred = { clientId: 'c1', clientSecret: 's1' };
  const t0 = 1_000_000;
  assert.strictEqual(await NuvemFiscalAdapter.obterTokenOAuth(cred, { agora: t0, buscar }), 'tok1');
  assert.strictEqual(await NuvemFiscalAdapter.obterTokenOAuth(cred, { agora: t0 + 60_000, buscar }), 'tok1');
  // A 4 min de vencer (margem de 5): renova.
  assert.strictEqual(await NuvemFiscalAdapter.obterTokenOAuth(cred, { agora: t0 + 3600_000 - 240_000, buscar }), 'tok2');
  assert.strictEqual(await NuvemFiscalAdapter.obterTokenOAuth(cred, { forcar: true, buscar }), 'tok3');

  // 401 no emissor com clientId/secret: renova (forcar) e tenta de novo uma vez.
  NuvemFiscalAdapter.limparCacheTokens();
  const a = new NuvemFiscalAdapter({ credencial: { dados: cred }, config: CONFIG, ambiente: 'homologacao', modo: 'live' });
  const tokens = [];
  a._token = async ({ forcar = false } = {}) => (forcar ? 'novo' : 'velho');
  let n = 0;
  a._executar = async (req) => {
    tokens.push(req.headers.Authorization);
    n += 1;
    if (n === 1) throw Object.assign(new Error('401'), { httpStatus: 401 });
    return { id: 'nf1', status: 'autorizado' };
  };
  const r = await a.consultarStatus('nf1', 'NFCE');
  assert.strictEqual(r.status, 'EMITIDA');
  assert.deepStrictEqual(tokens, ['Bearer velho', 'Bearer novo']);

  // So accessToken: 401 vira erro claro para atualizar a credencial.
  const b = new NuvemFiscalAdapter({ credencial: { dados: { accessToken: 'x' } }, config: CONFIG, ambiente: 'homologacao', modo: 'live' });
  b._executar = async () => { throw Object.assign(new Error('401'), { httpStatus: 401 }); };
  await assert.rejects(() => b.consultarStatus('nf1', 'NFCE'), /token da Nuvem Fiscal venceu/);
});

test('mensagem do emissor sai sem dado sensivel', () => {
  const m = mensagemDoEmissor({
    mensagem: 'Rejeicao: CPF 529.982.247-25 invalido para ana@exemplo.com',
    erros: [{ mensagem: 'NCM inexistente' }, { mensagem: 'CNPJ 11.222.333/0001-81 nao habilitado' }],
  });
  assert.match(m, /NCM inexistente/);
  assert.doesNotMatch(m, /529/);
  assert.doesNotMatch(m, /ana@/);
  assert.doesNotMatch(m, /11\.222/);
});

test('aliquota de IBS/CBS vazia no .env usa o padrao (nao zera)', () => {
  const antes = process.env.FISCAL_ALIQUOTA_CBS;
  process.env.FISCAL_ALIQUOTA_CBS = '';
  try {
    const { dados } = montarDadosNota({ tipo: 'NFCE', config: { ...CONFIG, regime: 'Lucro Real' }, itens: [ITENS[0]], valor: 20 });
    assert.strictEqual(dados.ibsCbs.aliquotaCbs, 0.9);
    process.env.FISCAL_ALIQUOTA_CBS = '8,8';
    assert.strictEqual(montarDadosNota({ tipo: 'NFCE', config: { ...CONFIG, regime: 'Lucro Real' }, itens: [ITENS[0]], valor: 20 }).dados.ibsCbs.aliquotaCbs, 8.8);
  } finally {
    if (antes === undefined) delete process.env.FISCAL_ALIQUOTA_CBS; else process.env.FISCAL_ALIQUOTA_CBS = antes;
  }
});

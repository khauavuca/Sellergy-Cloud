// Emissor da Sellergy (revenda Focus NFe): cadastro da empresa do cliente na
// conta da Sellergy e o token devolvido virando a credencial do cliente.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.MENSAGENS_MASTER_KEY = process.env.MENSAGENS_MASTER_KEY || crypto.randomBytes(32).toString('base64');
const prisma = require('../prisma');
const credenciais = require('../credenciais');
const { montarEmpresaFocus, salvarEmpresaFocus, explicarErroFocus } = require('../adapters/fiscal/focusRevenda');

let chavePlataforma = { dados: { token: 'MASTER' } };
let credRevendaAtual = null;
credenciais.carregarCredencialPlataforma = async () => chavePlataforma;
credenciais.carregarCredencialDecifrada = async () => credRevendaAtual;
const revenda = require('./revenda');

const CONFIG = {
  cnpj: '11.222.333/0001-81', razaoSocial: 'Clinica Lumi LTDA', nomeFantasia: 'Lumi', regime: 'MEI',
  inscricaoMunicipal: '12345', inscricao: null, logradouro: 'Rua A', numero: '10', bairro: 'Centro',
  municipio: 'São Paulo', uf: 'SP', cep: '01001-000', emailEmitente: 'a@b.com', csc: 'ABCDEF0123456789', cscId: '000001',
};

test('monta a empresa da Focus: regime, endereco, so os tipos que emite e sem campos vazios', () => {
  const so = montarEmpresaFocus(CONFIG, { tipos: ['NFSE'] });
  assert.equal(so.cnpj, '11222333000181');
  assert.equal(so.regime_tributario, 4);
  assert.equal(so.habilita_nfse, true);
  assert.equal(so.habilita_nfce, false);
  assert.equal(so.cep, '01001000');
  assert.ok(!('inscricao_estadual' in so));
  assert.ok(!('csc_nfce_producao' in so), 'CSC so vai quando emite NFC-e');
  assert.ok(!('arquivo_certificado_base64' in so));
  const loja = montarEmpresaFocus({ ...CONFIG, regime: 'Simples Nacional' }, { tipos: ['NFCE'], certificado: { base64: 'QUJD', senha: 's' } });
  assert.equal(loja.regime_tributario, 1);
  assert.equal(loja.csc_nfce_producao, 'ABCDEF0123456789');
  assert.equal(loja.id_token_nfce_producao, 1);
  assert.equal(loja.habilita_nfe, false);
  assert.equal(so.inscricao_municipal, '12345');
  assert.ok(!('inscricao_estadual' in montarEmpresaFocus({ ...CONFIG, inscricao: 'ISENTO' })), 'ISENTO nao vai');
  assert.equal(montarEmpresaFocus({ ...CONFIG, inscricao: '110042490114' }).inscricao_estadual, '110042490114');
  assert.equal(loja.arquivo_certificado_base64, 'QUJD');
  assert.equal(loja.senha_certificado, 's');
});

test('salvar na Focus: POST sem id, PUT com id, Basic com o token master; devolve os tokens', async () => {
  const chamadas = [];
  const fetchFn = async (url, op) => { chamadas.push({ url, op }); return { ok: true, status: 200, json: async () => ({ id: 77, token_producao: 'TP', token_homologacao: 'TH' }) }; };
  const r = await salvarEmpresaFocus({ masterToken: 'MASTER', corpo: { cnpj: '1' }, fetchFn });
  assert.deepEqual(r, { ok: true, empresaId: '77', tokenProducao: 'TP', tokenHomologacao: 'TH' });
  assert.equal(chamadas[0].op.method, 'POST');
  assert.equal(chamadas[0].url, 'https://api.focusnfe.com.br/v2/empresas');
  assert.equal(chamadas[0].op.headers.Authorization, `Basic ${Buffer.from('MASTER:').toString('base64')}`);
  await salvarEmpresaFocus({ masterToken: 'MASTER', empresaId: '77', corpo: {}, fetchFn });
  assert.equal(chamadas[1].op.method, 'PUT');
  assert.match(chamadas[1].url, /\/v2\/empresas\/77$/);
});

test('erros da Focus viram frase que o cliente entende', async () => {
  assert.match(explicarErroFocus(422, { erros: [{ mensagem: 'Certificado vencido em 01/01/2026' }] }), /vencido/);
  assert.match(explicarErroFocus(422, { mensagem: 'CNPJ do certificado difere do CNPJ da empresa' }), /outro CNPJ/);
  assert.match(explicarErroFocus(401, null), /suporte/);
  const caiu = await salvarEmpresaFocus({ masterToken: 'M', corpo: {}, fetchFn: async () => { throw new Error('timeout'); } });
  assert.equal(caiu.ok, false);
  assert.equal(caiu.status, 503);
});

test('modo do emissor', () => {
  assert.equal(revenda.modoEmissor({ credencialPropria: true, temChaveRevenda: true }), 'PROPRIO');
  assert.equal(revenda.modoEmissor({ temChaveRevenda: true }), 'SELLERGY');
  assert.equal(revenda.modoEmissor({ credencialRevenda: { id: 'x' } }), 'SELLERGY');
  assert.equal(revenda.modoEmissor({}), 'NENHUM');
});

function stubBanco() {
  const g = { criadas: [], atualizadas: [], config: null };
  prisma.credencial.findMany = async () => (g.revendaLinha ? [g.revendaLinha] : []);
  prisma.credencial.create = async ({ data }) => { g.criadas.push(data); return { id: 'cred-nova' }; };
  prisma.credencial.update = async ({ where, data }) => { g.atualizadas.push({ id: where.id, data }); return { id: where.id }; };
  prisma.configuracaoFiscal.update = async ({ data }) => { g.config = data; return data; };
  return g;
}

test('sincronizar (simulado): cria a credencial marcada como revenda e liga a configuracao', async () => {
  delete process.env.FISCAL_LIVE;
  chavePlataforma = { dados: { token: 'MASTER' } };
  credRevendaAtual = null;
  const g = stubBanco();
  const r = await revenda.sincronizarEmpresa({ clienteId: 'c1', config: CONFIG, tipos: ['NFSE'] });
  assert.deepEqual(r, { credencialId: 'cred-nova', simulado: true });
  assert.equal(g.criadas[0].tipo, 'FOCUS_NFE_KEY');
  assert.equal(g.criadas[0].descricao, revenda.MARCA_REVENDA);
  assert.deepEqual(g.config, { provedor: 'FOCUS_NFE', credencialId: 'cred-nova' });
});

test('sincronizar (real): cadastra na Focus com o certificado e guarda o token da empresa; depois atualiza', async () => {
  process.env.FISCAL_LIVE = 'true';
  try {
    const corpos = [];
    const fetchFn = async (url, op) => { corpos.push({ url, metodo: op.method, corpo: JSON.parse(op.body) }); return { ok: true, status: 200, json: async () => ({ id: 9, token_producao: 'TOK-P', token_homologacao: 'TOK-H' }) }; };
    credRevendaAtual = null;
    let g = stubBanco();
    await revenda.sincronizarEmpresa({ clienteId: 'c1', config: CONFIG, tipos: ['NFCE'], certificado: { base64: 'UEZY', senha: 'x' }, fetchFn });
    assert.equal(corpos[0].metodo, 'POST');
    assert.equal(corpos[0].corpo.arquivo_certificado_base64, 'UEZY');
    assert.equal(g.criadas.length, 1);

    // Segunda vez (CSC mudou): PUT na mesma empresa, mantendo o token.
    g = stubBanco();
    g.revendaLinha = { id: 'cred-r', tipo: 'FOCUS_NFE_KEY', descricao: revenda.MARCA_REVENDA };
    credRevendaAtual = { dados: { token: 'TOK-P', tokenHomologacao: 'TOK-H', empresaId: '9' } };
    await revenda.sincronizarEmpresa({ clienteId: 'c1', config: CONFIG, tipos: ['NFCE'], fetchFn });
    assert.equal(corpos[1].metodo, 'PUT');
    assert.match(corpos[1].url, /\/9$/);
    assert.equal(g.atualizadas[0].id, 'cred-r');
    assert.equal(g.criadas.length, 0);
  } finally {
    delete process.env.FISCAL_LIVE;
  }
});

test('sincronizar: sem a chave de revenda explica que falta liberar; recusa da Focus vira 422', async () => {
  chavePlataforma = null;
  await assert.rejects(revenda.sincronizarEmpresa({ clienteId: 'c1', config: CONFIG, tipos: ['NFSE'] }), (e) => e.status === 409 && /liberada/.test(e.message));
  chavePlataforma = { dados: { token: 'MASTER' } };
  process.env.FISCAL_LIVE = 'true';
  try {
    stubBanco();
    credRevendaAtual = null;
    const fetchFn = async () => ({ ok: false, status: 422, json: async () => ({ mensagem: 'Senha do certificado inválida' }) });
    await assert.rejects(revenda.sincronizarEmpresa({ clienteId: 'c1', config: CONFIG, tipos: ['NFSE'], certificado: { base64: 'A', senha: 'b' }, fetchFn }),
      (e) => e.status === 422 && /senha/.test(e.message));
  } finally {
    delete process.env.FISCAL_LIVE;
  }
});

test('cadastro sem tokens no retorno: consulta a empresa e pega os tokens', async () => {
  const urls = [];
  const fetchFn = async (url, op) => {
    urls.push(`${op.method} ${url}`);
    if (op.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 5, token_producao: '', token_homologacao: '' }) };
    return { ok: true, status: 200, json: async () => ({ id: 5, token_producao: 'P5', token_homologacao: 'H5' }) };
  };
  const r = await salvarEmpresaFocus({ masterToken: 'M', corpo: {}, fetchFn });
  assert.deepEqual(r, { ok: true, empresaId: '5', tokenProducao: 'P5', tokenHomologacao: 'H5' });
  assert.deepEqual(urls, ['POST https://api.focusnfe.com.br/v2/empresas', 'GET https://api.focusnfe.com.br/v2/empresas/5']);
});

test('CNPJ trocado: cria outra empresa na Focus em vez de alterar a antiga', async () => {
  process.env.FISCAL_LIVE = 'true';
  try {
    const metodos = [];
    const fetchFn = async (url, op) => { metodos.push(op.method); return { ok: true, status: 200, json: async () => ({ id: 12, token_producao: 'NP', token_homologacao: 'NH' }) }; };
    const g = stubBanco();
    g.revendaLinha = { id: 'cred-r', tipo: 'FOCUS_NFE_KEY', descricao: revenda.MARCA_REVENDA };
    credRevendaAtual = { dados: { token: 'VELHO', empresaId: '9', cnpj: '99888777000166' } };
    await revenda.sincronizarEmpresa({ clienteId: 'c1', config: CONFIG, tipos: ['NFSE'], certificado: { base64: 'A', senha: 'b' }, fetchFn });
    assert.deepEqual(metodos, ['POST']);
    assert.equal(g.atualizadas[0].id, 'cred-r', 'reaproveita a linha da credencial');
  } finally {
    delete process.env.FISCAL_LIVE;
  }
});

test('emissao usa o token de homologacao no teste e o de producao depois de ativar', () => {
  const FocusNFeAdapter = require('../adapters/fiscal/focusNFe');
  const credencial = { dados: { token: 'TOK-P', tokenHomologacao: 'TOK-H' } };
  assert.equal(new FocusNFeAdapter({ credencial, ambiente: 'homologacao' })._token, 'TOK-H');
  assert.equal(new FocusNFeAdapter({ credencial, ambiente: 'producao' })._token, 'TOK-P');
  // Chave propria (cadastrada pelo admin) continua com um token so.
  assert.equal(new FocusNFeAdapter({ credencial: { dados: { token: 'UNICO' } }, ambiente: 'homologacao' })._token, 'UNICO');
});

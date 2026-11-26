// CPF/CNPJ de quem paga (Asaas) e o webhook simulado. Banco falso em memoria
// no lugar de ../prisma e cofre de credenciais trocado por um stub.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

delete process.env.PAGAMENTO_LIVE; // fixture: nada sai pra rede

const estado = { provedor: 'ASAAS', leads: [], cobrancas: [], leadUpdates: [] };

const prismaFalso = {
  configuracaoPagamento: {
    findUnique: async () => ({ clienteId: 't1', provedor: estado.provedor, credencialId: null, ativo: true }),
  },
  lead: {
    findFirst: async ({ where }) => estado.leads.find((l) => l.id === where.id && l.clienteId === where.clienteId) || null,
    findMany: async ({ where }) => estado.leads.filter((l) => l.clienteId === where.clienteId && String(l.telefone || '').includes(where.telefone.contains)),
    update: async ({ where, data }) => { estado.leadUpdates.push({ id: where.id, ...data }); const l = estado.leads.find((x) => x.id === where.id); Object.assign(l, data); return l; },
  },
  cobranca: {
    create: async ({ data }) => { const c = { id: `cob-${estado.cobrancas.length + 1}`, ...data }; estado.cobrancas.push(c); return c; },
    update: async ({ where, data }) => { const c = estado.cobrancas.find((x) => x.id === where.id); Object.assign(c, data); return { ...c }; },
  },
  variacaoProduto: {
    findFirst: async () => ({ id: 'v1', nome: 'P', estoqueAtual: 10, preco: 50, produto: { nome: 'Camiseta', tipo: 'FISICO' } }),
  },
};

function injetar(rel, exports) {
  const caminho = require.resolve(path.join(__dirname, rel));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports };
}
injetar('../prisma', prismaFalso);
injetar('../credenciais', { carregarCredencialDecifrada: async () => null });

const { criarCobranca, webhookPodeAplicar, leadPorTelefone } = require('./pagamentoService');
const { resolverPagador, cpfCnpjValido, exigeCpfCnpj } = require('./pagadorCobranca');
const gerarCobrancaPix = require('./iaFerramentas/gerarCobrancaPix');

const CPF_OK = '529.982.247-25';
const CNPJ_OK = '11.222.333/0001-81';

function limpar() {
  estado.provedor = 'ASAAS';
  estado.leads = [];
  estado.cobrancas = [];
  estado.leadUpdates = [];
}

// ---------- webhook simulado ----------

test('webhook: so aplica em live; simulado so com PAGAMENTO_WEBHOOK_SIMULADO=1 fora de producao', () => {
  assert.equal(webhookPodeAplicar('live', {}), true);
  assert.equal(webhookPodeAplicar('live', { NODE_ENV: 'production' }), true);
  assert.equal(webhookPodeAplicar('fixture', {}), false);
  assert.equal(webhookPodeAplicar('fixture', { NODE_ENV: 'development' }), false);
  assert.equal(webhookPodeAplicar('fixture', { PAGAMENTO_WEBHOOK_SIMULADO: '1' }), true);
  assert.equal(webhookPodeAplicar('fixture', { PAGAMENTO_WEBHOOK_SIMULADO: 'true' }), false);
  assert.equal(webhookPodeAplicar('fixture', { NODE_ENV: 'production', PAGAMENTO_WEBHOOK_SIMULADO: '1' }), false);
});

// ---------- regra do pagador ----------

test('resolverPagador: CPF digitado, do lead, invalido e faltando', () => {
  assert.equal(exigeCpfCnpj('ASAAS'), true);
  assert.equal(exigeCpfCnpj('MERCADO_PAGO'), false);
  assert.equal(cpfCnpjValido(CPF_OK), '52998224725');
  assert.equal(cpfCnpjValido(CNPJ_OK), '11222333000181');
  assert.equal(cpfCnpjValido('111.111.111-11'), null);

  const digitado = resolverPagador({ provedor: 'ASAAS', pagador: { cpfCnpj: CPF_OK }, lead: { id: 'l1', cpf: null } });
  assert.equal(digitado.pagador.cpfCnpj, '52998224725');
  assert.equal(digitado.cpfNovoDoLead, '52998224725');

  const doLead = resolverPagador({ provedor: 'ASAAS', pagador: {}, lead: { id: 'l1', nome: 'Ana', cpf: '52998224725' } });
  assert.equal(doLead.pagador.cpfCnpj, '52998224725');
  assert.equal(doLead.pagador.nome, 'Ana');
  assert.equal(doLead.cpfNovoDoLead, null);

  assert.throws(() => resolverPagador({ provedor: 'ASAAS', pagador: { cpfCnpj: '123.456.789-00' } }), (e) => e.codigo === 'CPF_CNPJ_INVALIDO' && e.status === 422);
  assert.throws(() => resolverPagador({ provedor: 'ASAAS', pagador: {} }), (e) => e.codigo === 'PAGADOR_SEM_CPF' && e.campos[0] === 'cpfCnpj');
  // CNPJ digitado nao vai pro lead (o campo do lead e CPF)
  assert.equal(resolverPagador({ provedor: 'ASAAS', pagador: { cpfCnpj: CNPJ_OK }, lead: { id: 'l1' } }).cpfNovoDoLead, null);
  // outros provedores nao exigem
  assert.equal(resolverPagador({ provedor: 'MERCADO_PAGO', pagador: {} }).pagador.cpfCnpj, undefined);
});

test('criarCobranca (Asaas) sem CPF: recusa ANTES de criar a cobranca', async () => {
  limpar();
  await assert.rejects(
    () => criarCobranca({ clienteId: 't1', valor: 10, descricao: 'x' }),
    (e) => e.codigo === 'PAGADOR_SEM_CPF',
  );
  assert.equal(estado.cobrancas.length, 0);
});

test('criarCobranca (Asaas) usa o CPF do lead e grava o digitado no lead sem CPF', async () => {
  limpar();
  estado.leads = [{ id: 'l1', clienteId: 't1', nome: 'Ana', telefone: '5511988887777', cpf: '52998224725' }];
  const c1 = await criarCobranca({ clienteId: 't1', valor: 10, leadId: 'l1' });
  assert.equal(c1.status, 'PENDENTE');
  assert.equal(estado.leadUpdates.length, 0);

  estado.leads = [{ id: 'l2', clienteId: 't1', nome: 'Bia', telefone: '5511977776666', cpf: null }];
  await criarCobranca({ clienteId: 't1', valor: 10, leadId: 'l2', pagador: { cpfCnpj: CPF_OK } });
  assert.deepEqual(estado.leadUpdates, [{ id: 'l2', cpf: '52998224725' }]);
});

test('criarCobranca (Mercado Pago) segue sem CPF', async () => {
  limpar();
  estado.provedor = 'MERCADO_PAGO';
  const c = await criarCobranca({ clienteId: 't1', valor: 10 });
  assert.ok(c.qrCode);
});

test('leadPorTelefone acha com ou sem 55 e prefere quem tem CPF', async () => {
  limpar();
  estado.leads = [
    { id: 'a', clienteId: 't1', telefone: '11988887777', cpf: null },
    { id: 'b', clienteId: 't1', telefone: '+55 (11) 98888-7777', cpf: '52998224725' },
  ];
  assert.equal((await leadPorTelefone('t1', '5511988887777')).id, 'b');
  assert.equal(await leadPorTelefone('t1', '123'), null);
});

// ---------- bot ----------

test('bot (Asaas) sem CPF: pede o CPF ao cliente e nao gera Pix', async () => {
  limpar();
  const r = await gerarCobrancaPix.executar({ itens: [{ produto: 'Camiseta', quantidade: 1 }] }, { clienteId: 't1', telefoneCliente: '5511900000000' });
  assert.equal(r.precisaCpf, true);
  assert.match(r.instrucao, /CPF/);
  assert.equal(estado.cobrancas.length, 0);
});

test('bot (Asaas) com CPF informado pelo cliente gera o Pix; CPF invalido pede de novo', async () => {
  limpar();
  const ruim = await gerarCobrancaPix.executar({ itens: [{ produto: 'Camiseta', quantidade: 1 }], cpf_cnpj: '12345678900' }, { clienteId: 't1' });
  assert.equal(ruim.precisaCpf, true);
  const ok = await gerarCobrancaPix.executar({ itens: [{ produto: 'Camiseta', quantidade: 1 }], cpf_cnpj: '52998224725' }, { clienteId: 't1' });
  assert.equal(ok.sucesso, true);
  assert.ok(ok.qrCode);
});

test('bot (Asaas) usa o CPF do lead da conversa sem perguntar', async () => {
  limpar();
  estado.leads = [{ id: 'l1', clienteId: 't1', nome: 'Ana', telefone: '5511988887777', cpf: '52998224725' }];
  const r = await gerarCobrancaPix.executar({ itens: [{ produto: 'Camiseta', quantidade: 2 }] }, { clienteId: 't1', telefoneCliente: '5511988887777' });
  assert.equal(r.sucesso, true);
  assert.equal(r.valor, 100);
});

test('ferramenta do bot declara o parametro cpf_cnpj (opcional)', () => {
  const p = gerarCobrancaPix.definicao.function.parameters;
  assert.ok(p.properties.cpf_cnpj);
  assert.deepEqual(p.required, ['itens']);
});

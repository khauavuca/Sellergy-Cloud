const test = require('node:test');
const assert = require('node:assert/strict');
const asaas = require('./subcontaAsaas');
const { resumirTaxas } = require('./contaRecebimento');
const { modoPagamento, ambienteDaCredencial, normalizarAmbiente } = require('../services/pagamentoService');

const ENTRADA = {
  negocio: {
    cnpj: '11.222.333/0001-81', razaoSocial: ' Clínica   Lumi Estética LTDA ', nomeFantasia: 'Clínica Lumi', tipoEmpresa: 'limited',
    email: 'Contato@Lumi.com.br', telefone: '(11) 98877-2210', faturamentoMensal: '25000',
    cep: '05422-030', endereco: 'Rua dos Pinheiros', numero: '1000', complemento: 'sala 2', bairro: 'Pinheiros',
  },
  responsavel: { nome: 'Marina Souza', cpf: '529.982.247-25', dataNascimento: '1988-04-12', celular: '11988772210' },
  repasse: { prazo: 'PADRAO', tipoChavePix: 'CNPJ', chavePix: '11.222.333/0001-81' },
};

test('valida e normaliza os 3 passos', () => {
  const d = asaas.validarDadosSubconta(ENTRADA, new Date('2026-11-23T12:00:00'));
  assert.equal(d.negocio.cnpj, '11222333000181');
  assert.equal(d.negocio.razaoSocial, 'Clínica Lumi Estética LTDA');
  assert.equal(d.negocio.tipoEmpresa, 'LIMITED');
  assert.equal(d.negocio.email, 'contato@lumi.com.br');
  assert.equal(d.negocio.faturamentoMensal, 25000);
  assert.equal(d.responsavel.cpf, '52998224725');
  assert.equal(d.repasse.chavePix, '11222333000181');
});

test('campos errados voltam com o nome do passo', () => {
  const ruim = {
    negocio: { ...ENTRADA.negocio, cnpj: '11.111.111/1111-11', cep: '123', tipoEmpresa: 'SA' },
    responsavel: { ...ENTRADA.responsavel, cpf: '123', dataNascimento: '2015-01-01' },
    repasse: { prazo: 'AMANHA', tipoChavePix: 'CNPJ', chavePix: '' },
  };
  assert.throws(() => asaas.validarDadosSubconta(ruim, new Date('2026-11-23T12:00:00')), (e) => {
    for (const c of ['negocio.cnpj', 'negocio.cep', 'negocio.tipoEmpresa', 'responsavel.cpf', 'responsavel.dataNascimento', 'repasse.prazo', 'repasse.chavePix']) {
      assert.ok(e.campos.includes(c), c);
    }
    return e.status === 422;
  });
});

test('chave Pix CNPJ tem que ser do mesmo CNPJ da conta', () => {
  const outra = { ...ENTRADA, repasse: { prazo: 'PADRAO', tipoChavePix: 'CNPJ', chavePix: '11.444.777/0001-61' } };
  assert.throws(() => asaas.validarDadosSubconta(outra), (e) => /mesmo CNPJ/.test(e.message));
  assert.equal(asaas.validarChavePix('EMAIL', 'financeiro@lumi.com.br'), null);
  assert.equal(asaas.validarChavePix('PHONE', asaas.normalizarChavePix('PHONE', '+55 (11) 98877-2210')), null);
  assert.ok(asaas.validarChavePix('EVP', 'nao-e-uuid'));
});

test('payload do POST /accounts com dados do negocio e webhooks', () => {
  const d = asaas.validarDadosSubconta(ENTRADA, new Date('2026-11-23T12:00:00'));
  const corpo = asaas.montarPayloadSubconta(d, {
    webhookSecret: 'a'.repeat(48), apiUrlPublica: 'https://api.sellergycloud.com/', tokenWebhookPlataforma: 'b'.repeat(40), contaId: 'conta-1',
  });
  assert.equal(corpo.name, 'Clínica Lumi Estética LTDA');
  assert.equal(corpo.cpfCnpj, '11222333000181');
  assert.equal(corpo.companyType, 'LIMITED');
  assert.equal(corpo.incomeValue, 25000);
  assert.equal(corpo.postalCode, '05422030');
  assert.equal(corpo.province, 'Pinheiros');
  assert.equal(corpo.address, 'Rua dos Pinheiros');
  assert.equal(corpo.addressNumber, '1000');
  assert.equal(corpo.webhooks.length, 2);
  assert.equal(corpo.webhooks[0].url, 'https://api.sellergycloud.com/webhooks/pagamento/asaas');
  assert.equal(corpo.webhooks[0].authToken, 'a'.repeat(48));
  assert.ok(corpo.webhooks[0].events.includes('PAYMENT_RECEIVED'));
  assert.equal(corpo.webhooks[1].url, 'https://api.sellergycloud.com/webhooks/assinatura/asaas?conta=conta-1');
  assert.ok(corpo.webhooks[1].events.every((e) => e.startsWith('ACCOUNT_STATUS_')));
  // nada do responsavel nem segredo da plataforma no corpo
  assert.ok(!JSON.stringify(corpo).includes('52998224725'));
});

test('sem URL https publica ou com token curto, nao cadastra webhook', () => {
  const d = asaas.validarDadosSubconta(ENTRADA, new Date('2026-11-23T12:00:00'));
  assert.equal(asaas.montarPayloadSubconta(d, { webhookSecret: 'x', apiUrlPublica: 'http://localhost:3333' }).webhooks, undefined);
  const so1 = asaas.montarPayloadSubconta(d, { webhookSecret: 'x'.repeat(48), apiUrlPublica: 'https://api.x.com', tokenWebhookPlataforma: 'curto', contaId: 'c' });
  assert.equal(so1.webhooks.length, 1);
});

test('status da conta', () => {
  assert.equal(asaas.mapearStatusConta({ general: 'APPROVED' }), 'ATIVA');
  assert.equal(asaas.mapearStatusConta({ general: 'REJECTED' }), 'RECUSADA');
  assert.equal(asaas.mapearStatusConta({ general: 'AWAITING_APPROVAL' }), 'EM_ANALISE');
  assert.equal(asaas.mapearStatusConta({}), 'EM_ANALISE');
  assert.match(asaas.motivoRecusa({ general: 'REJECTED', documentation: 'REJECTED' }), /documentos/);
});

test('dados publicos escondem o CPF do responsavel', () => {
  const d = asaas.validarDadosSubconta(ENTRADA, new Date('2026-11-23T12:00:00'));
  const pub = asaas.dadosPublicos({ ...d, credencialId: 'segredo-nao' });
  assert.equal(pub.responsavel.cpf, '***.982.247-**');
  assert.ok(!JSON.stringify(pub).includes('credencialId'));
});

test('taxas do Asaas viram linhas simples', () => {
  const r = resumirTaxas({
    payment: {
      pix: { fixedFeeValue: 0, percentageFee: 0.99 },
      creditCard: { operationValue: 0.49, oneInstallmentPercentage: 2.99, upToSixInstallmentsPercentage: 3.49 },
    },
    transfer: { pix: { feeValue: 0 } },
  });
  assert.deepEqual(r.linhas.map((l) => l.forma), ['Pix', 'Crédito à vista', 'Crédito 2 a 6×']);
  assert.equal(r.linhas[0].percentual, 0.99);
  assert.equal(r.saque, 0);
});

test('modo e ambiente do PSP do tenant', () => {
  assert.equal(modoPagamento({}), 'fixture');
  assert.equal(modoPagamento({ PAGAMENTO_LIVE: 'true' }), 'live');
  assert.equal(modoPagamento({ PAGAMENTO_LIVE: '1' }), 'fixture');
  assert.equal(normalizarAmbiente('sandbox'), 'homologacao');
  assert.equal(normalizarAmbiente('producao'), 'producao');
  assert.equal(ambienteDaCredencial({ dados: { ambiente: 'sandbox' } }, { PAGAMENTO_LIVE: 'true' }), 'homologacao');
  assert.equal(ambienteDaCredencial({ dados: {} }, { PAGAMENTO_LIVE: 'true' }), 'producao');
  assert.equal(ambienteDaCredencial(null, {}), 'homologacao');
  assert.equal(ambienteDaCredencial(null, { PAGAMENTO_AMBIENTE_PADRAO: 'producao' }), 'producao');
});

// Conta de recebimento: chave da subconta no cofre antes de tudo, saque sem
// duplicar e confirmacao de identidade pra trocar a chave Pix. Banco, cofre e
// Asaas trocados por stubs (nada sai pra rede).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const contas = new Map();
const chamadasUpdate = [];
let falharCofre = false;

function casa(l, where) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return v.some((w) => casa(l, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('lt' in v) return l[k] != null && l[k] < v.lt;
      if ('not' in v) return l[k] !== v.not;
    }
    return l[k] === v;
  });
}

const prismaFalso = {
  contaRecebimento: {
    findUnique: async ({ where }) => {
      if (where.id) return contas.get(where.id) ? { ...contas.get(where.id) } : null;
      for (const c of contas.values()) if (c.clienteId === where.clienteId) return { ...c };
      return null;
    },
    create: async ({ data }) => { const c = { id: `conta-${contas.size + 1}`, contaExternaId: null, saqueTravadoAte: null, ...data }; contas.set(c.id, c); return { ...c }; },
    update: async ({ where, data }) => { chamadasUpdate.push(data); const c = contas.get(where.id); Object.assign(c, data); return { ...c }; },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const c of contas.values()) if (casa(c, where)) { Object.assign(c, data); count++; }
      return { count };
    },
  },
  credencial: {
    create: async () => { if (falharCofre) throw new Error('banco fora'); return { id: 'cred-1' }; },
  },
  configuracaoPagamento: { findUnique: async () => ({ ativo: true }), upsert: async () => ({}) },
  usuario: { findMany: async () => [] },
};

function injetar(rel, exports) {
  const caminho = require.resolve(path.join(__dirname, rel));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports };
}
injetar('../prisma', prismaFalso);
injetar('../credenciais', { carregarCredencialDecifrada: async () => ({ dados: { apiKey: 'chave-subconta' } }) });
injetar('../cripto/cofreCredenciais', { cifrarPayload: () => ({ conteudoCifrado: 'x', iv: 'i', tag: 't', versaoChave: 1 }) });
injetar('../assinatura/avisos', { avisarNoWhatsapp: async () => {} });

const asaas = require('./subcontaAsaas');
const conta = require('./contaRecebimento');

const ENTRADA = {
  negocio: {
    cnpj: '11.222.333/0001-81', razaoSocial: 'Clinica Lumi LTDA', nomeFantasia: 'Lumi', tipoEmpresa: 'limited',
    email: 'contato@lumi.com.br', telefone: '(11) 98877-2210', faturamentoMensal: '25000',
    cep: '05422-030', endereco: 'Rua dos Pinheiros', numero: '1000', complemento: '', bairro: 'Pinheiros',
  },
  responsavel: { nome: 'Marina Souza', cpf: '529.982.247-25', dataNascimento: '1988-04-12', celular: '11988772210' },
  repasse: { prazo: 'PADRAO', tipoChavePix: 'CNPJ', chavePix: '11.222.333/0001-81' },
};

test('abrir: cofre falhou depois do Asaas criar a subconta -> id externo gravado, erro claro, chave fora do log', async () => {
  process.env.ASAAS_PLATAFORMA_API_KEY = 'chave-plataforma';
  falharCofre = true;
  asaas.criarSubconta = async () => ({ id: 'acc_1', apiKey: 'CHAVE-SECRETA-DA-SUBCONTA', walletId: 'w1' });
  const logs = [];
  const errOriginal = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  try {
    await assert.rejects(() => conta.abrir('t-abrir', ENTRADA), (e) => e.codigo === 'CHAVE_NAO_GUARDADA');
  } finally {
    console.error = errOriginal;
    falharCofre = false;
  }
  const c = [...contas.values()].find((x) => x.clienteId === 't-abrir');
  assert.equal(c.contaExternaId, 'acc_1'); // recuperavel: nao abre uma segunda subconta
  assert.match(c.motivoRecusa, /CHAVE_PENDENTE/);
  assert.ok(logs.some((l) => l.includes('acc_1')));
  assert.ok(!logs.some((l) => l.includes('CHAVE-SECRETA-DA-SUBCONTA')));
  // tentar de novo nao chama o Asaas outra vez
  let chamouDeNovo = false;
  asaas.criarSubconta = async () => { chamouDeNovo = true; return { id: 'acc_2', apiKey: 'k2' }; };
  await assert.rejects(() => conta.abrir('t-abrir', ENTRADA));
  assert.equal(chamouDeNovo, false);
});

function contaAtiva(id) {
  const c = { id, clienteId: `cli-${id}`, status: 'ATIVA', contaExternaId: 'acc', saqueTravadoAte: null, dados: { credencialId: 'cred-1', repasse: { tipoChavePix: 'CNPJ', chavePix: '11222333000181' }, negocio: { cnpj: '11222333000181' } } };
  contas.set(id, c);
  return { ...c };
}

test('saque: dois pedidos seguidos -> so um Pix sai', async () => {
  const c = contaAtiva('s1');
  let transferencias = 0;
  asaas.saldo = async () => ({ balance: 500 });
  asaas.transferirPix = async () => { transferencias++; await new Promise((r) => setImmediate(r)); return { id: 'tr1', status: 'PENDING' }; };
  const resultados = await Promise.allSettled([conta.sacar(c, 100), conta.sacar(c, 100)]);
  assert.equal(transferencias, 1);
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(resultados.find((r) => r.status === 'rejected').reason.codigo, 'SAQUE_RECENTE');
  // logo depois, ainda travado
  await assert.rejects(() => conta.sacar(c, 50), (e) => e.codigo === 'SAQUE_RECENTE');
});

test('saque: saldo insuficiente ou Asaas recusou (4xx) libera a trava; 5xx/timeout segura', async () => {
  const c = contaAtiva('s2');
  asaas.saldo = async () => ({ balance: 10 });
  await assert.rejects(() => conta.sacar(c, 100), (e) => e.codigo === 'SALDO_INSUFICIENTE');
  assert.equal(contas.get('s2').saqueTravadoAte, null);

  asaas.saldo = async () => ({ balance: 500 });
  asaas.transferirPix = async () => { throw new asaas.ErroSubconta('Chave invalida', 422, { codigo: 'ASAAS_RECUSOU' }); };
  await assert.rejects(() => conta.sacar(c, 100), (e) => e.codigo === 'ASAAS_RECUSOU');
  assert.equal(contas.get('s2').saqueTravadoAte, null);

  asaas.transferirPix = async () => { throw Object.assign(new Error('Tempo esgotado'), { codigo: 'TIMEOUT' }); };
  await assert.rejects(() => conta.sacar(c, 100), /Tempo esgotado/);
  assert.ok(contas.get('s2').saqueTravadoAte > new Date()); // pode ter saido: segura
});

test('trocaChavePix: so quando muda tipo ou chave', () => {
  const c = contaAtiva('r1');
  assert.equal(conta.trocaChavePix(c, {}), false);
  assert.equal(conta.trocaChavePix(c, { tipoChavePix: 'CNPJ', chavePix: '11.222.333/0001-81' }), false);
  assert.equal(conta.trocaChavePix(c, { tipoChavePix: 'EMAIL', chavePix: 'a@b.com' }), true);
  assert.equal(conta.trocaChavePix(c, { chavePix: '11.444.777/0001-61' }), true);
});

test('confirmarIdentidade: senha sem 2 etapas; codigo com 2 etapas', async () => {
  const bcrypt = { compare: async (s, h) => s === 'certa' && h === 'hash' };
  const totp = { decifrarSegredo: () => 'seg', verificarCodigo: (_s, c) => (c === '123456' ? 1 : null) };
  const semTotp = { id: 'u1', senha: 'hash', totpAtivo: false };
  await assert.rejects(() => conta.confirmarIdentidade(semTotp, {}, { bcrypt, totp }), (e) => e.codigo === 'CONFIRMACAO_NECESSARIA' && e.status === 401);
  await assert.rejects(() => conta.confirmarIdentidade(semTotp, { senha: 'errada' }, { bcrypt, totp }), (e) => e.codigo === 'CONFIRMACAO_INVALIDA');
  assert.equal(await conta.confirmarIdentidade(semTotp, { senha: 'certa' }, { bcrypt, totp }), true);

  const comTotp = { id: 'u2', senha: 'hash', totpAtivo: true, totpSegredoCifrado: 'x' };
  await assert.rejects(() => conta.confirmarIdentidade(comTotp, { senha: 'certa' }, { bcrypt, totp }), (e) => e.campos[0] === 'codigo');
  await assert.rejects(() => conta.confirmarIdentidade(comTotp, { codigo: '000000' }, { bcrypt, totp }), (e) => e.codigo === 'CONFIRMACAO_INVALIDA');
  assert.equal(await conta.confirmarIdentidade(comTotp, { codigo: '123456' }, { bcrypt, totp }), true);
});

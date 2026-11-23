const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste';
const { validarCadastro, slugBase } = require('./cadastro');
const { montarPassos } = require('./passos');
const { competenciaDe, somarUmMes, valorDaFatura } = require('../assinatura/cobranca');

const valido = {
  nomeNegocio: 'Clínica Bem Estar', nomeResponsavel: 'Ana Lima', email: ' Ana@Exemplo.com ',
  senha: 'segura123', telefone: '(11) 98888-7777', segmento: 'servico',
};

test('cadastro valido normaliza e-mail, telefone e segmento', () => {
  const { dados, erro } = validarCadastro(valido);
  assert.equal(erro, undefined);
  assert.equal(dados.email, 'ana@exemplo.com');
  assert.equal(dados.telefone, '11988887777');
  assert.equal(dados.segmento, 'SERVICO');
});

test('cadastro recusa senha curta, e-mail ruim e segmento desconhecido', () => {
  const r = validarCadastro({ ...valido, senha: '123', email: 'nao-e-email', segmento: 'PADARIA' });
  assert.deepEqual(r.campos.sort(), ['email', 'segmento', 'senha']);
  assert.match(r.erro, /8 caracteres/);
});

test('cadastro nunca aceita perfil vindo do corpo (so os campos conhecidos passam)', () => {
  const { dados } = validarCadastro({ ...valido, perfil: 'ADMIN', clienteId: 'x' });
  assert.equal(dados.perfil, undefined);
  assert.equal(dados.clienteId, undefined);
});

test('slug sem acento, sem simbolo e com limite', () => {
  assert.equal(slugBase('Clínica Bem-Estar & Spa!'), 'clinica-bem-estar-spa');
  assert.equal(slugBase('!!!'), 'negocio');
  assert.ok(slugBase('a'.repeat(100)).length <= 40);
});

const zerado = { temHorario: false, profissionais: 0, servicos: 0, produtosFisicos: 0, agendamentos: 0, vendas: 0, whatsappConectado: false, pagamentoConfigurado: false, agendamentosPeloLink: 0 };

test('assistente da clinica comeca pelo horario e termina no link', () => {
  const r = montarPassos('SERVICO', zerado);
  assert.equal(r.proximo, 'horario');
  assert.equal(r.feitos, 0);
  assert.ok(r.passos.some((p) => p.chave === 'linkAgendamento'));
  assert.ok(!r.passos.some((p) => p.chave === 'produtos'));
});

test('assistente da loja: produtos -> clientes -> primeira venda', () => {
  const r = montarPassos('PRODUTO', { ...zerado, produtosFisicos: 3 });
  assert.equal(r.proximo, 'clientes');
  assert.equal(r.feitos, 1);
  const r2 = montarPassos('PRODUTO', { ...zerado, produtosFisicos: 3, clientes: 10 });
  assert.equal(r2.proximo, 'primeiraVenda');
});

test('assistente completo quando tudo existe', () => {
  const tudo = { clientes: 1, temHorario: true, profissionais: 1, servicos: 1, produtosFisicos: 1, agendamentos: 1, vendas: 1, whatsappConectado: true, pagamentoConfigurado: true, agendamentosPeloLink: 1 };
  assert.equal(montarPassos('HIBRIDO', tudo).completo, true);
});

test('fatura: competencia, mes seguinte sem pular mes e valor do plano', () => {
  assert.equal(competenciaDe(new Date(2026, 10, 21)), '2026-11');
  const fimJan = somarUmMes(new Date(2026, 0, 31));
  assert.equal(fimJan.getMonth(), 1); // fevereiro, nao marco
  assert.equal(valorDaFatura({ plano: 'PRO', mensalidade: 0 }), 119);
  assert.equal(valorDaFatura({ plano: 'PRO', mensalidade: 89.9 }), 89.9);
});

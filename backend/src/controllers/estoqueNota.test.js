// Regras puras de estoque, nota de compra, fornecedor e cupom de campanha
// (correcoes dos testes de uso).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste';
const test = require('node:test');
const assert = require('node:assert');
const Estoque = require('./EstoqueController');
const Nota = require('./NotaCompraController');
const Fornecedor = require('./FornecedorController');
const campanhas = require('../routes/campanhas.routes');

const ID = '11111111-1111-1111-1111-111111111111';

test('movimentar: tipo VENDA manual e recusado (venda so pela tela de Vendas)', () => {
  const r = Estoque.validarMovimentacao({ variacaoId: ID, tipo: 'VENDA', quantidade: -1, precoVenda: 25 });
  assert.ok(r.erro);
  assert.deepStrictEqual(r.campos, ['tipo']);
});

test('movimentar: quantidade 0, 2.7, "3,5", 1e12 e tipo inventado sao recusados', () => {
  for (const quantidade of [0, 2.7, '3,5', 1e12, 3000000000]) {
    assert.ok(Estoque.validarMovimentacao({ variacaoId: ID, tipo: 'AJUSTE', quantidade }).erro, String(quantidade));
  }
  assert.ok(Estoque.validarMovimentacao({ variacaoId: ID, tipo: 'ROUBO', quantidade: 1 }).erro);
});

test('movimentar: id lixo vira 404; preco "abc" e negativo recusados; "10,50" vira 10.5', () => {
  assert.strictEqual(Estoque.validarMovimentacao({ variacaoId: ['x'], tipo: 'AJUSTE', quantidade: 1 }).status, 404);
  assert.ok(Estoque.validarMovimentacao({ variacaoId: ID, tipo: 'AJUSTE', quantidade: 1, precoCusto: 'abc' }).erro);
  assert.ok(Estoque.validarMovimentacao({ variacaoId: ID, tipo: 'AJUSTE', quantidade: 1, precoVenda: -5 }).erro);
  const ok = Estoque.validarMovimentacao({ variacaoId: ID, tipo: 'COMPRA_FORNECEDOR', quantidade: '2', precoCusto: '10,50' });
  assert.strictEqual(ok.dados.precoCusto, 10.5);
  assert.strictEqual(ok.dados.quantidade, 2);
});

test('ajustes em lote/balanco: item invalido da erro claro (nao e pulado)', () => {
  assert.ok(Estoque.validarAjustes({ variacaoId: ID }, 'novoEstoque').erro);
  assert.ok(Estoque.validarAjustes([{ variacaoId: ID, estoqueReal: 'abc' }], 'estoqueReal').erro);
  assert.ok(Estoque.validarAjustes([{ variacaoId: ID, novoEstoque: -5 }], 'novoEstoque').erro);
  assert.ok(Estoque.validarAjustes([{ variacaoId: ID, novoEstoque: 3000000000 }], 'novoEstoque').erro);
  assert.strictEqual(Estoque.validarAjustes([{ variacaoId: 'nao-existe', estoqueReal: 5 }], 'estoqueReal').status, 404);
  assert.deepStrictEqual(Estoque.validarAjustes([{ variacaoId: ID, estoqueReal: '7' }], 'estoqueReal').itens[0].novo, 7);
});

test('nota: custo medio ignora estoque negativo (-5 a 50 + 10 a 60 = 60) e pondera o positivo', () => {
  assert.strictEqual(Nota.custoMedio(-5, 50, 10, 60), 60);
  assert.strictEqual(Nota.custoMedio(0, 50, 10, 60), 60);
  assert.strictEqual(Nota.custoMedio(10, 50, 10, 60), 55);
});

test('nota: custo absurdo, quantidade decimal/0/3e9 e data 31/02 recusados; virgula aceita', () => {
  const item = (q, c) => ({ itens: [{ variacaoId: ID, quantidade: q, custoUnitario: c }] });
  assert.ok(Nota.validarNota(item(1, 1e12)).erro);
  assert.ok(Nota.validarNota(item(2.9, 1)).erro);
  assert.ok(Nota.validarNota(item(0, 1)).erro);
  assert.ok(Nota.validarNota(item(3000000000, 1)).erro);
  assert.ok(Nota.validarNota(item(1, -1)).erro);
  assert.ok(Nota.validarNota({ ...item(1, 1), emitidaEm: '2026-02-31' }).erro);
  const ok = Nota.validarNota(item('3', '10,50'));
  assert.deepStrictEqual(ok.dados.normalizados[0], { variacaoId: ID, quantidade: 3, custoUnitario: 10.5 });
});

test('fornecedor: nome objeto ou so espacos e recusado (nao vira "[object Object]")', () => {
  assert.ok(Fornecedor.montarDados({ nome: { a: 1 } }).erro);
  assert.ok(Fornecedor.montarDados({ nome: '   ' }).erro);
  assert.strictEqual(Fornecedor.montarDados({ nome: '  Acme  ' }).data.nome, 'Acme');
});

test('cupom: so dono/administrador cria; vendedor nao', () => {
  assert.strictEqual(campanhas.podeCriarCupom({ perfil: 'CLIENT' }), true);
  assert.strictEqual(campanhas.podeCriarCupom({ perfil: 'ADMINISTRADOR' }), true);
  assert.strictEqual(campanhas.podeCriarCupom({ perfil: 'VENDEDOR' }), false);
});

test('cupom: valida valor, data 31/02, limite de uso e codigo', () => {
  assert.ok(campanhas.validarDadosCupom({ codigo: 'X', tipo: 'PERCENTUAL', valor: 150 }).erro);
  assert.ok(campanhas.validarDadosCupom({ codigo: 'X', tipo: 'VALOR', valor: -5 }).erro);
  assert.ok(campanhas.validarDadosCupom({ codigo: 'X', valor: 1, validoAte: '2027-02-31' }).erro);
  assert.ok(campanhas.validarDadosCupom({ codigo: 'X', valor: 1, usoMaximo: 'abc' }).erro);
  assert.ok(campanhas.validarDadosCupom({ codigo: '<b>x</b>', valor: 1 }).erro);
  const ok = campanhas.validarDadosCupom({ codigo: 'promo10', tipo: 'VALOR', valor: '10,50', usoMaximo: 1 });
  assert.deepStrictEqual(ok.dados, { codigo: 'PROMO10', tipo: 'VALOR', valor: 10.5, validoAte: null, usoMaximo: 1 });
});

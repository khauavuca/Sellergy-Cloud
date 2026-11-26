const test = require('node:test');
const assert = require('node:assert');
const CatalogoController = require('./CatalogoController');
const { validarCamposDevolucao, lerVariacao, lerCamposProduto } = CatalogoController;

test('variacao: so campos permitidos (id/produtoId/clienteId ignorados)', () => {
  const r = lerVariacao({ nome: 'P', preco: 10, id: 'x', produtoId: 'outro', clienteId: 'outro', criadoEm: 'x' });
  assert.ok(!r.erro);
  assert.deepStrictEqual(Object.keys(r.data).sort(), ['nome', 'preco']);
});

test('variacao: preco/duracao negativos ou absurdos sao recusados', () => {
  assert.ok(lerVariacao({ nome: 'P', preco: -50 }).erro);
  assert.ok(lerVariacao({ nome: 'P', preco: 1e12 }).erro);
  assert.ok(lerVariacao({ nome: 'P', preco: 'abc' }).erro);
  assert.ok(lerVariacao({ nome: 'P', preco: 10, duracaoMin: -10 }).erro);
  assert.ok(lerVariacao({ nome: 'P', preco: 10, duracaoMin: 0 }).erro);
  assert.ok(lerVariacao({ nome: 'P', preco: 10, duracaoMin: 100000 }).erro);
  assert.ok(lerVariacao({ nome: 'P', estoqueAtual: -3 }).erro);
  assert.ok(lerVariacao({ nome: '' }).erro);
  assert.ok(lerVariacao(['x']).erro);
});

test('variacao: "10,50" vira 10.5 e preco explicito vale (lucro = preco - custo)', () => {
  const r = lerVariacao({ nome: 'P', preco: '10,50', precoCusto: '4' });
  assert.strictEqual(r.data.preco, 10.5);
  assert.strictEqual(r.data.lucroTipo, 'VALOR');
  assert.strictEqual(r.data.lucroValor, 6.5);
});

test('variacao: com lucro, preco sai de custo + lucro', () => {
  const r = lerVariacao({ nome: 'P', precoCusto: 10, lucroTipo: 'PERCENTUAL', lucroValor: 50, preco: 999 });
  assert.strictEqual(r.data.preco, 15);
  assert.ok(lerVariacao({ nome: 'P', precoCusto: 10, lucroTipo: 'VALOR', lucroValor: -20 }).erro, 'preco final negativo');
  assert.ok(lerVariacao({ nome: 'P', lucroTipo: 'XYZ' }).erro);
});

test('variacao (edicao): so custo recalcula com o lucro atual', () => {
  const r = lerVariacao({ precoCusto: 20 }, { parcial: true, atual: { precoCusto: 10, lucroTipo: 'VALOR', lucroValor: 5 } });
  assert.strictEqual(r.data.preco, 25);
  assert.deepStrictEqual(lerVariacao({}, { parcial: true }).data, {});
});

test('produto: tipo/visibilidade so valores conhecidos, nome com limite', () => {
  assert.ok(lerCamposProduto({ nome: 'X', tipo: 'XYZ' }).erro);
  assert.ok(lerCamposProduto({ nome: 'X', visibilidade: 'XYZ' }).erro);
  assert.ok(lerCamposProduto({ nome: '   ' }).erro);
  assert.ok(lerCamposProduto({ nome: 'a'.repeat(6000) }).erro);
  assert.ok(lerCamposProduto({ nome: 'X', descricao: 'a'.repeat(6000) }).erro);
  const ok = lerCamposProduto({ nome: ' Corte ', tipo: 'SERVICO' });
  assert.deepStrictEqual(ok.data, { nome: 'Corte', tipo: 'SERVICO', visibilidade: 'ATIVO' });
});

test('temDevolucao=true em produto FISICO e aceito', () => {
  const r = validarCamposDevolucao({ tipoEfetivo: 'FISICO', temDevolucao: true, diasParaDevolucaoPadrao: undefined });
  assert.strictEqual(r.erro, undefined);
  assert.strictEqual(r.data.temDevolucao, true);
});

test('temDevolucao=true em produto SERVICO e rejeitado', () => {
  const r = validarCamposDevolucao({ tipoEfetivo: 'SERVICO', temDevolucao: true, diasParaDevolucaoPadrao: undefined });
  assert.ok(r.erro);
  assert.strictEqual(r.campo, 'temDevolucao');
});

test('temDevolucao=false em SERVICO e aceito (desligar sempre pode)', () => {
  const r = validarCamposDevolucao({ tipoEfetivo: 'SERVICO', temDevolucao: false, diasParaDevolucaoPadrao: undefined });
  assert.strictEqual(r.erro, undefined);
  assert.strictEqual(r.data.temDevolucao, false);
});

test('temDevolucao nao-booleano e rejeitado', () => {
  const r = validarCamposDevolucao({ tipoEfetivo: 'FISICO', temDevolucao: 'sim', diasParaDevolucaoPadrao: undefined });
  assert.ok(r.erro);
});

test('diasParaDevolucaoPadrao aceita inteiro positivo', () => {
  const r = validarCamposDevolucao({ tipoEfetivo: 'FISICO', temDevolucao: undefined, diasParaDevolucaoPadrao: 3 });
  assert.strictEqual(r.data.diasParaDevolucaoPadrao, 3);
});

test('diasParaDevolucaoPadrao null ou vazio limpa o campo', () => {
  const a = validarCamposDevolucao({ tipoEfetivo: 'FISICO', temDevolucao: undefined, diasParaDevolucaoPadrao: null });
  assert.strictEqual(a.data.diasParaDevolucaoPadrao, null);
  const b = validarCamposDevolucao({ tipoEfetivo: 'FISICO', temDevolucao: undefined, diasParaDevolucaoPadrao: '' });
  assert.strictEqual(b.data.diasParaDevolucaoPadrao, null);
});

test('diasParaDevolucaoPadrao <= 0 ou nao-numerico e rejeitado', () => {
  assert.ok(validarCamposDevolucao({ tipoEfetivo: 'FISICO', diasParaDevolucaoPadrao: 0 }).erro);
  assert.ok(validarCamposDevolucao({ tipoEfetivo: 'FISICO', diasParaDevolucaoPadrao: -2 }).erro);
  assert.ok(validarCamposDevolucao({ tipoEfetivo: 'FISICO', diasParaDevolucaoPadrao: 'abc' }).erro);
});

test('nenhum campo enviado nao gera erro nem data', () => {
  const r = validarCamposDevolucao({ tipoEfetivo: 'FISICO' });
  assert.strictEqual(r.erro, undefined);
  assert.deepStrictEqual(r.data, {});
});

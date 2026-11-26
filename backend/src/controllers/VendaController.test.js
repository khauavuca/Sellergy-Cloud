const test = require('node:test');
const assert = require('node:assert');
const VendaController = require('./VendaController');
const { validarClienteFinal, resolverDataDevolucao } = VendaController;

const CPF_VALIDO = '111.444.777-35';

test('validarClienteFinal aceita nome/telefone/cpf validos e normaliza pra so-digitos', () => {
  const r = validarClienteFinal({ nome: '  Ana Silva  ', telefone: '(11) 99999-8888', cpf: CPF_VALIDO });
  assert.strictEqual(r.erro, undefined);
  assert.strictEqual(r.nome, 'Ana Silva');
  assert.strictEqual(r.telefone, '11999998888');
  assert.strictEqual(r.cpf, '11144477735');
});

test('validarClienteFinal rejeita sem nome', () => {
  const r = validarClienteFinal({ nome: '', telefone: '11999998888', cpf: CPF_VALIDO });
  assert.ok(r.erro);
  assert.strictEqual(r.campo, 'clienteFinal.nome');
});

test('validarClienteFinal rejeita sem telefone', () => {
  const r = validarClienteFinal({ nome: 'Ana', telefone: '', cpf: CPF_VALIDO });
  assert.ok(r.erro);
  assert.strictEqual(r.campo, 'clienteFinal.telefone');
});

test('validarClienteFinal rejeita telefone com digitos demais ou de menos', () => {
  const curto = validarClienteFinal({ nome: 'Ana', telefone: '119999', cpf: CPF_VALIDO });
  assert.ok(curto.erro);
  assert.strictEqual(curto.campo, 'clienteFinal.telefone');

  const longo = validarClienteFinal({ nome: 'Ana', telefone: '629959999999999999999', cpf: CPF_VALIDO });
  assert.ok(longo.erro);
  assert.strictEqual(longo.campo, 'clienteFinal.telefone');
});

test('validarClienteFinal aceita telefone fixo (10 digitos) alem do celular (11)', () => {
  const r = validarClienteFinal({ nome: 'Ana', telefone: '1133334444', cpf: CPF_VALIDO });
  assert.strictEqual(r.erro, undefined);
  assert.strictEqual(r.telefone, '1133334444');
});

test('validarClienteFinal rejeita cpf invalido (digito verificador errado)', () => {
  const r = validarClienteFinal({ nome: 'Ana', telefone: '11999998888', cpf: '111.444.777-00' });
  assert.ok(r.erro);
  assert.strictEqual(r.campo, 'clienteFinal.cpf');
});

test('validarClienteFinal rejeita objeto ausente', () => {
  const r = validarClienteFinal(undefined);
  assert.ok(r.erro);
});

test('resolverDataDevolucao usa a data explicita quando informada e valida', () => {
  const agora = new Date('2026-01-01T00:00:00Z');
  const r = resolverDataDevolucao({ dataDevolucaoInput: '2026-01-10', diasParaDevolucaoPadrao: null, nomeProduto: 'Furadeira', agora });
  assert.strictEqual(r.erro, undefined);
  assert.ok(r.data instanceof Date);
  assert.strictEqual(r.data.toISOString().slice(0, 10), '2026-01-10');
});

test('resolverDataDevolucao rejeita data invalida', () => {
  const r = resolverDataDevolucao({ dataDevolucaoInput: 'nao-e-data', diasParaDevolucaoPadrao: null, nomeProduto: 'Furadeira' });
  assert.ok(r.erro);
});

test('resolverDataDevolucao rejeita data no passado ou igual a agora', () => {
  const agora = new Date('2026-01-10T12:00:00Z');
  const r = resolverDataDevolucao({ dataDevolucaoInput: '2026-01-05', diasParaDevolucaoPadrao: null, nomeProduto: 'Furadeira', agora });
  assert.ok(r.erro);
});

test('resolverDataDevolucao cai pro prazo padrao do produto quando a data nao vem', () => {
  const agora = new Date('2026-01-01T00:00:00Z');
  const r = resolverDataDevolucao({ dataDevolucaoInput: undefined, diasParaDevolucaoPadrao: 3, nomeProduto: 'Fantasia', agora });
  assert.strictEqual(r.erro, undefined);
  assert.strictEqual(r.data.toISOString(), '2026-01-04T00:00:00.000Z');
});

test('resolverDataDevolucao exige data manual quando nao ha data nem prazo padrao', () => {
  const r = resolverDataDevolucao({ dataDevolucaoInput: undefined, diasParaDevolucaoPadrao: null, nomeProduto: 'Fantasia' });
  assert.ok(r.erro);
  assert.match(r.erro, /Fantasia/);
});

// ----- Correcoes dos testes de uso (vendas) -----
const {
  normalizarMetodoPagamento, lerParcelas, podeDarDesconto, lerDataEstrita, calcularEstornoEstoque,
} = VendaController;

test('forma de pagamento: so as conhecidas; vazio = nao informado; apelido de cartao vira o curto', () => {
  assert.deepStrictEqual(normalizarMetodoPagamento('pix'), { valor: 'PIX' });
  assert.deepStrictEqual(normalizarMetodoPagamento(''), { valor: null });
  assert.deepStrictEqual(normalizarMetodoPagamento('CARTAO_CREDITO'), { valor: 'CREDITO' });
  assert.ok(normalizarMetodoPagamento('BITCOIN').erro);
  assert.ok(normalizarMetodoPagamento('<img src=x onerror=alert(1)>').erro);
  assert.ok(normalizarMetodoPagamento(5).erro);
});

test('parcelas: 1..24 no credito; 999, 0, 1,5 e texto recusados; fora do credito vira 1', () => {
  assert.deepStrictEqual(lerParcelas(12, 'CREDITO'), { valor: 12 });
  assert.deepStrictEqual(lerParcelas(undefined, 'CREDITO'), { valor: 1 });
  assert.deepStrictEqual(lerParcelas(3, 'PIX'), { valor: 1 });
  assert.ok(lerParcelas(999, 'CREDITO').erro);
  assert.ok(lerParcelas(0, 'CREDITO').erro);
  assert.ok(lerParcelas('1,5', 'CREDITO').erro);
  assert.ok(lerParcelas('abc', 'CREDITO').erro);
});

test('desconto manual: dono/administrador sempre; vendedor so com VENDAS.desconto', () => {
  assert.strictEqual(podeDarDesconto({ perfil: 'CLIENT' }, null), true);
  assert.strictEqual(podeDarDesconto({ perfil: 'ADMINISTRADOR' }, null), true);
  assert.strictEqual(podeDarDesconto({ perfil: 'VENDEDOR' }, { VENDAS: { criar: true } }), false);
  assert.strictEqual(podeDarDesconto({ perfil: 'VENDEDOR' }, { VENDAS: { desconto: true } }), true);
});

test('data estrita: recusa 31/02, ano 3000 e ano < 1900; aceita data real', () => {
  assert.strictEqual(lerDataEstrita('2027-02-31'), null);
  assert.strictEqual(lerDataEstrita('3000-01-01'), null);
  assert.strictEqual(lerDataEstrita('1800-01-01'), null);
  assert.strictEqual(lerDataEstrita('2027-02-28').toISOString().slice(0, 10), '2027-02-28');
});

test('resolverDataDevolucao recusa 31/02 e ano 3000', () => {
  const agora = new Date('2026-11-25T00:00:00Z');
  assert.ok(resolverDataDevolucao({ dataDevolucaoInput: '2027-02-31', nomeProduto: 'Vestido', agora }).erro);
  assert.ok(resolverDataDevolucao({ dataDevolucaoInput: '3000-01-01', nomeProduto: 'Vestido', agora }).erro);
});

test('estorno do cancelamento: so o que ainda nao voltou (devolucao concluida nao devolve de novo)', () => {
  const fis = { produto: { tipo: 'FISICO' } };
  // Vendeu 2, devolucao de aluguel ja trouxe 2 -> nada a devolver.
  assert.deepStrictEqual(calcularEstornoEstoque([
    { variacaoId: 'a', quantidade: -2, variacao: fis },
    { variacaoId: 'a', quantidade: 2, variacao: fis },
  ]), []);
  // Vendeu 3 de b (pendente) e 1 servico -> devolve 3 fisico + 1 servico (sem estoque).
  assert.deepStrictEqual(calcularEstornoEstoque([
    { variacaoId: 'b', quantidade: -3, variacao: fis },
    { variacaoId: 's', quantidade: -1, variacao: { produto: { tipo: 'SERVICO' } } },
  ]), [{ variacaoId: 'b', quantidade: 3, fisico: true }, { variacaoId: 's', quantidade: 1, fisico: false }]);
});

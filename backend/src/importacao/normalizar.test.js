const test = require('node:test');
const assert = require('node:assert');
const n = require('./normalizar');

test('telefone: mascara, 55 e nono digito', () => {
  assert.deepStrictEqual(n.normalizarTelefone('(11) 98812-4410'), { valor: '5511988124410', corrigido: false });
  assert.deepStrictEqual(n.normalizarTelefone('+55 11 98812-4410'), { valor: '5511988124410', corrigido: false });
  assert.deepStrictEqual(n.normalizarTelefone('11 9812-4410'), { valor: '5511998124410', corrigido: true });
  assert.deepStrictEqual(n.normalizarTelefone('551198124410'), { valor: '5511998124410', corrigido: true });
  // fixo (comeca com 2-5) nao ganha 9
  assert.deepStrictEqual(n.normalizarTelefone('(11) 3333-4444'), { valor: '551133334444', corrigido: false });
  // 0 + operadora
  assert.strictEqual(n.normalizarTelefone('0 21 11 98812-4410').valor, '5511988124410');
  assert.deepStrictEqual(n.normalizarTelefone(''), { valor: null });
});

test('telefone: sem DDD sugere o DDD do negocio, DDD invalido e erro', () => {
  const r = n.normalizarTelefone('9812-4410', { dddPadrao: '11' });
  assert.ok(r.erro);
  assert.strictEqual(r.sugestao.valor, '5511998124410');
  assert.match(r.sugestao.texto, /11 e 9/);
  assert.ok(!n.normalizarTelefone('9812-4410').sugestao);
  assert.ok(n.normalizarTelefone('(20) 98812-4410').erro);
  assert.ok(n.normalizarTelefone('12345').erro);
  assert.ok(n.normalizarTelefone('(11) 88812-44101').erro);
});

test('CPF: digito verificador e zero a esquerda comido pelo Excel', () => {
  assert.deepStrictEqual(n.normalizarCpf('529.982.247-25'), { valor: '52998224725' });
  assert.ok(n.normalizarCpf('529.982.247-26').erro);
  assert.ok(n.normalizarCpf('111.111.111-11').erro);
  // 012.345.678-90 e valido; o Excel guarda 1234567890
  assert.deepStrictEqual(n.normalizarCpf('1234567890'), { valor: '01234567890' });
  assert.deepStrictEqual(n.normalizarCpf(''), { valor: null });
});

test('e-mail, data, numero e duracao', () => {
  assert.deepStrictEqual(n.normalizarEmail(' Paula@Gmail.com '), { valor: 'paula@gmail.com' });
  assert.ok(n.normalizarEmail('paula@gmail').erro);
  assert.deepStrictEqual(n.normalizarData('22/04/1990'), { valor: '1990-04-22' });
  assert.deepStrictEqual(n.normalizarData('1990-04-22'), { valor: '1990-04-22' });
  assert.deepStrictEqual(n.normalizarData('32874'), { valor: '1990-01-01' });
  assert.ok(n.normalizarData('31/02/1990').erro);
  assert.ok(n.normalizarData('ontem').erro);
  assert.deepStrictEqual(n.normalizarNumero('R$ 1.234,56'), { valor: 1234.56 });
  assert.deepStrictEqual(n.normalizarNumero('1234.56'), { valor: 1234.56 });
  assert.deepStrictEqual(n.normalizarNumero('1.500'), { valor: 1500 });
  assert.deepStrictEqual(n.normalizarNumero('89,9'), { valor: 89.9 });
  assert.deepStrictEqual(n.normalizarNumero(12), { valor: 12 });
  assert.ok(n.normalizarNumero('doze').erro);
  assert.deepStrictEqual(n.normalizarDuracao('1h30'), { valor: 90 });
  assert.deepStrictEqual(n.normalizarDuracao('01:30'), { valor: 90 });
  assert.deepStrictEqual(n.normalizarDuracao('45 min'), { valor: 45 });
  assert.ok(n.normalizarDuracao('2').erro);
});

test('mapeamento automatico de colunas, inclusive nomes de outros sistemas', () => {
  const m = n.sugerirMapeamento(['Nome', 'Cel', 'Nasc', 'Ult. visita', 'E-mail', 'Obs'], 'CLIENTES');
  assert.deepStrictEqual(m, { Nome: 'nome', Cel: 'telefone', Nasc: 'nascimento', 'Ult. visita': null, 'E-mail': 'email', Obs: 'observacoes' });
  const m2 = n.sugerirMapeamento(['Cliente', 'Telefone Celular (WhatsApp)', 'Data de Nascimento', 'CPF/CNPJ'], 'CLIENTES');
  assert.strictEqual(m2.Cliente, 'nome');
  assert.strictEqual(m2['Telefone Celular (WhatsApp)'], 'telefone');
  assert.strictEqual(m2['Data de Nascimento'], 'nascimento');
  assert.strictEqual(m2['CPF/CNPJ'], 'cpf');
  // Bling/Tiny: "Descrição" e o nome do produto; "Código" e o SKU
  const p = n.sugerirMapeamento(['Código', 'Descrição', 'Preço', 'Preço de custo', 'Estoque', 'GTIN/EAN'], 'PRODUTOS');
  assert.strictEqual(p['Descrição'], 'nome');
  assert.strictEqual(p['Código'], 'sku');
  assert.strictEqual(p['Preço'], 'preco');
  assert.strictEqual(p['Preço de custo'], 'custo');
  assert.strictEqual(p.Estoque, 'estoque');
  const s = n.sugerirMapeamento(['Serviço', 'Valor', 'Tempo (min)'], 'SERVICOS');
  assert.deepStrictEqual(s, { 'Serviço': 'nome', Valor: 'preco', 'Tempo (min)': 'duracao' });
});

test('validacao por linha: nome vazio sugere nome, problemas por campo', () => {
  const r = n.validarLinha('CLIENTES', { nome: '', telefone: '11988124410', email: 'x@', cpf: '' }, { numero: 290 });
  assert.deepStrictEqual(r.problemas.map((p) => p.campo), ['nome', 'email']);
  assert.strictEqual(r.problemas[0].sugestao.valor, 'Cliente 290');
  const p = n.validarLinha('PRODUTOS', { nome: 'Sérum', preco: '89,90', custo: '40', estoque: '3', sku: ' 789 1234 ' });
  assert.deepStrictEqual(p.problemas, []);
  assert.deepStrictEqual(p.dados, { nome: 'Sérum', preco: 89.9, custo: 40, estoque: 3, sku: '7891234', categoria: null, descricao: null });
  assert.ok(n.validarLinha('PRODUTOS', { nome: 'X', preco: '' }).problemas.some((x) => x.campo === 'preco'));
  assert.ok(n.validarLinha('PRODUTOS', { nome: 'X', preco: '1', estoque: '2,5' }).problemas.some((x) => x.campo === 'estoque'));
});

test('duplicados dentro do arquivo por telefone, e-mail ou nome', () => {
  const r = n.validarLinhas('CLIENTES', [
    { nome: 'Fernanda Castro', telefone: '(11) 98812-4410' },
    { nome: 'Fernanda C.', telefone: '11988124410' },
    { nome: 'Outra', email: 'a@b.com' },
    { nome: 'Outra 2', email: 'A@B.com' },
    { nome: 'Pulada', telefone: '11988124410', pular: true },
  ]);
  assert.strictEqual(r[0].duplicadaDe, null);
  assert.strictEqual(r[1].duplicadaDe, 0);
  assert.strictEqual(r[3].duplicadaDe, 2);
  assert.strictEqual(r[4].pular, true);
  const p = n.validarLinhas('PRODUTOS', [{ nome: 'Batom Rosa', preco: 10 }, { nome: 'batom  rosa', preco: 12 }]);
  assert.strictEqual(p[1].duplicadaDe, 0);
});

test('juntar so preenche campos vazios', () => {
  assert.deepStrictEqual(
    n.juntarCamposVazios({ nome: 'Ana', email: null, cpf: '' }, { nome: 'Ana Paula', email: 'a@b.com', cpf: '52998224725' }),
    { nome: 'Ana', email: 'a@b.com', cpf: '52998224725' },
  );
});

test('data do Excel gravada com fuso (serial quebrado) arredonda pro dia certo', () => {
  assert.deepStrictEqual(n.normalizarData('32984.875'), { valor: '1990-04-22' });
  assert.deepStrictEqual(n.normalizarData(32985), { valor: '1990-04-22' });
});

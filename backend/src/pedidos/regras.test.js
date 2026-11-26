const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarItens, recalcularPedido, validarContato, podeIr, origensPara, ErroPedido, textos, brl,
} = require('./regras');
const { proximoNumero } = require('./pedidoService');

const ID_A = '11111111-1111-1111-1111-111111111111';
const ID_B = '22222222-2222-2222-2222-222222222222';
const ID_S = '33333333-3333-3333-3333-333333333333';

function variacoes() {
  return new Map([
    [ID_A, { id: ID_A, nome: 'Padrão', preco: 89.9, estoqueAtual: 5, produto: { id: 'pa', nome: 'Sérum vitamina C', tipo: 'FISICO', visibilidade: 'ATIVO' } }],
    [ID_B, { id: ID_B, nome: '200 ml', preco: 34.9, estoqueAtual: 1, produto: { id: 'pb', nome: 'Água micelar', tipo: 'FISICO', visibilidade: 'ATIVO' } }],
    [ID_S, { id: ID_S, nome: 'Padrão', preco: 150, estoqueAtual: 0, produto: { id: 'ps', nome: 'Limpeza de pele', tipo: 'SERVICO', visibilidade: 'ATIVO' } }],
  ]);
}
const REGRAS = { entrega: 'RETIRADA', aceitaRetirada: true, aceitaEntrega: true, freteEntrega: 12, pedidoMinimo: null };

test('preco vem do banco, nunca do navegador', () => {
  const itens = normalizarItens([{ variacaoId: ID_A, quantidade: 2, precoUnitario: 0.01, preco: 1 }]);
  const r = recalcularPedido(itens, variacoes(), REGRAS);
  assert.equal(r.itens[0].precoUnitario, 89.9);
  assert.equal(r.subtotal, 179.8);
  assert.equal(r.total, 179.8);
  assert.equal(r.itens[0].nome, 'Sérum vitamina C');
  assert.equal('preco' in itens[0], false);
});

test('total soma frete da entrega e arredonda em centavos', () => {
  const itens = normalizarItens([{ variacaoId: ID_A, quantidade: 3 }, { variacaoId: ID_B, quantidade: 1 }]);
  const r = recalcularPedido(itens, variacoes(), { ...REGRAS, entrega: 'ENTREGA' });
  assert.equal(r.subtotal, 304.6);
  assert.equal(r.frete, 12);
  assert.equal(r.total, 316.6);
  assert.equal(r.itens[1].nome, 'Água micelar — 200 ml');
});

test('retirada nao cobra frete; frete manual so quando informado', () => {
  const itens = normalizarItens([{ variacaoId: ID_A, quantidade: 1 }]);
  assert.equal(recalcularPedido(itens, variacoes(), REGRAS).frete, 0);
  assert.equal(recalcularPedido(itens, variacoes(), { ...REGRAS, entrega: 'ENTREGA', freteManual: 7.5 }).frete, 7.5);
  assert.equal(recalcularPedido(itens, variacoes(), { ...REGRAS, entrega: 'ENTREGA', freteManual: null }).frete, 12);
});

test('itens repetidos se juntam e quantidades invalidas sao recusadas', () => {
  assert.deepEqual(normalizarItens([{ variacaoId: ID_A, quantidade: 1 }, { variacaoId: ID_A, quantidade: 2 }]), [{ variacaoId: ID_A, quantidade: 3 }]);
  for (const q of [0, -1, 1.5, 100, 'dois', null]) {
    assert.throws(() => normalizarItens([{ variacaoId: ID_A, quantidade: q }]), ErroPedido, `quantidade ${q}`);
  }
  assert.throws(() => normalizarItens([]), ErroPedido);
  assert.throws(() => normalizarItens([{ variacaoId: 'x; drop table', quantidade: 1 }]), ErroPedido);
  assert.throws(() => normalizarItens([{ variacaoId: ID_A, quantidade: 60 }, { variacaoId: ID_A, quantidade: 60 }]), ErroPedido);
});

test('estoque insuficiente devolve 409 com o disponivel', () => {
  const itens = normalizarItens([{ variacaoId: ID_B, quantidade: 2 }]);
  assert.throws(() => recalcularPedido(itens, variacoes(), REGRAS), (e) => e.status === 409 && e.codigo === 'SEM_ESTOQUE' && e.semEstoque[0].disponivel === 1);
});

test('produto inexistente, servico ou inativo nao entra', () => {
  assert.throws(() => recalcularPedido(normalizarItens([{ variacaoId: ID_S, quantidade: 1 }]), variacoes(), REGRAS), (e) => e.codigo === 'PRODUTO_INDISPONIVEL');
  const v = variacoes();
  v.get(ID_A).produto.visibilidade = 'INATIVO';
  assert.throws(() => recalcularPedido(normalizarItens([{ variacaoId: ID_A, quantidade: 1 }]), v, REGRAS), (e) => e.codigo === 'PRODUTO_INDISPONIVEL');
  assert.throws(() => recalcularPedido(normalizarItens([{ variacaoId: '44444444-4444-4444-4444-444444444444', quantidade: 1 }]), variacoes(), REGRAS), ErroPedido);
});

test('pedido minimo vale sobre o subtotal (sem frete)', () => {
  const itens = normalizarItens([{ variacaoId: ID_B, quantidade: 1 }]);
  assert.throws(() => recalcularPedido(itens, variacoes(), { ...REGRAS, entrega: 'ENTREGA', pedidoMinimo: 40 }), (e) => e.codigo === 'PEDIDO_MINIMO');
  assert.equal(recalcularPedido(itens, variacoes(), { ...REGRAS, pedidoMinimo: 30 }).total, 34.9);
});

test('forma de entrega desligada na loja e recusada', () => {
  const itens = normalizarItens([{ variacaoId: ID_A, quantidade: 1 }]);
  assert.throws(() => recalcularPedido(itens, variacoes(), { ...REGRAS, entrega: 'ENTREGA', aceitaEntrega: false }), (e) => e.campos.includes('entrega'));
  assert.throws(() => recalcularPedido(itens, variacoes(), { ...REGRAS, aceitaRetirada: false }), (e) => e.campos.includes('entrega'));
});

test('contato: nome, celular, CPF valido e endereco na entrega', () => {
  const ok = validarContato({ nome: '  Camila   Duarte ', telefone: '(11) 98877-2210', cpf: '529.982.247-25' });
  assert.deepEqual([ok.nome, ok.telefone, ok.cpf], ['Camila Duarte', '11988772210', '52998224725']);
  assert.throws(() => validarContato({ nome: 'C', telefone: '123' }), (e) => e.campos.includes('nome') && e.campos.includes('telefone'));
  assert.throws(() => validarContato({ nome: 'Camila', telefone: '11988772210', cpf: '111.111.111-11' }), (e) => e.campos.includes('cpf'));
  assert.throws(() => validarContato({ nome: 'Camila', telefone: '11988772210' }, { exigeCpf: true }), (e) => e.campos.includes('cpf'));
  assert.throws(() => validarContato({ nome: 'Camila', telefone: '11988772210' }, { entrega: 'ENTREGA' }), (e) => e.campos.includes('endereco'));
  assert.equal(validarContato({ nome: 'Camila', telefone: '11988772210', endereco: 'Rua X, 10' }).endereco, null);
});

test('transicoes do pedido', () => {
  assert.ok(podeIr('NOVO', 'AGUARDANDO_PAGAMENTO'));
  assert.ok(podeIr('NOVO', 'PAGO'));
  assert.ok(podeIr('AGUARDANDO_PAGAMENTO', 'PAGO'));
  assert.ok(podeIr('AGUARDANDO_PAGAMENTO', 'AGUARDANDO_PAGAMENTO'), 'reenviar cobranca');
  assert.ok(podeIr('PAGO', 'ENTREGUE'));
  assert.ok(podeIr('NOVO', 'CANCELADO'));
  assert.ok(!podeIr('PAGO', 'CANCELADO'), 'pago nao cancela sem estorno');
  assert.ok(!podeIr('NOVO', 'ENTREGUE'), 'nao entrega sem pagar');
  assert.ok(!podeIr('ENTREGUE', 'PAGO'));
  assert.ok(!podeIr('CANCELADO', 'AGUARDANDO_PAGAMENTO'));
  assert.ok(!podeIr('XYZ', 'PAGO'));
  assert.deepEqual(origensPara('PAGO').sort(), ['AGUARDANDO_PAGAMENTO', 'NOVO']);
  assert.deepEqual(origensPara('ENTREGUE'), ['PAGO']);
});

test('numero sequencial por tenant comeca em 1 e segue o maior', async () => {
  const fakeTx = (ultimo) => ({ pedido: { findFirst: async ({ where, orderBy }) => {
    assert.equal(where.clienteId, 'c1');
    assert.deepEqual(orderBy, { numero: 'desc' });
    return ultimo === null ? null : { numero: ultimo };
  } } });
  assert.equal(await proximoNumero(fakeTx(null), 'c1'), 1);
  assert.equal(await proximoNumero(fakeTx(41), 'c1'), 42);
});

test('mensagem da cobranca leva link, Pix e total formatado', () => {
  const pedido = { numero: 7, nomeCliente: 'Fernanda Lima', total: 1232.4, frete: 12, itens: [{ quantidade: 1, nome: 'Sérum' }] };
  const t = textos.cobranca({ pedido, negocio: 'Clínica Lumi', link: 'https://x/pedido/abc', pix: '000201PIX' });
  assert.match(t, /Oi, Fernanda!/);
  assert.match(t, /R\$ 1\.232,40/);
  assert.match(t, /https:\/\/x\/pedido\/abc/);
  assert.match(t, /000201PIX/);
  assert.equal(brl(0.5), 'R$ 0,50');
});

// Catalogo: o pedido vira mensagem pronta pro WhatsApp do negocio.
const test = require('node:test');
const assert = require('node:assert');
const { paraWaMe, mensagemDoPedido } = require('./publicoCatalogo.routes')._internos;

test('numero vira formato do wa.me (com 55) ou null', () => {
  assert.equal(paraWaMe('(11) 98765-4321'), '5511987654321');
  assert.equal(paraWaMe('+55 11 3333-4444'), '551133334444');
  assert.equal(paraWaMe('5511987654321'), '5511987654321');
  assert.equal(paraWaMe('123'), null);
  assert.equal(paraWaMe(null), null);
});

test('mensagem do pedido lista os itens, o total e como recebe', () => {
  const m = mensagemDoPedido({
    numero: 128, total: 201.9, entrega: 'ENTREGA',
    itens: [{ nome: 'Vestido midi', quantidade: 1, subtotal: 189.9 }, { nome: 'Frete? nao', quantidade: 2, precoUnitario: 6 }],
  });
  assert.equal(m, 'Olá! Acabei de fazer o pedido #128 pelo catálogo:\n• 1x Vestido midi — R$ 189,90\n• 2x Frete? nao — R$ 12,00\nTotal: R$ 201,90 (entrega)');
  assert.match(mensagemDoPedido({ numero: 1, total: 10, entrega: 'RETIRADA', itens: [] }), /retirada na loja/);
});

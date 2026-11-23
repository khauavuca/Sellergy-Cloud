// Rotinas periodicas dos pedidos (carregadas por agenda/rotinasFase2.js no worker).
// Pedido da loja ou do WhatsApp que ficou 24 h sem pagamento e cancelado e o
// cliente recebe o aviso. Estoque nao muda: so baixa quando paga.

const { expirarPedidosVencidos } = require('./pedidoService');

module.exports = [
  {
    nome: 'pedidos-expirar-sem-pagamento',
    intervaloMs: 10 * 60 * 1000,
    rodar: async () => {
      const r = await expirarPedidosVencidos();
      if (r.expirados) console.log(`[pedidos] ${r.expirados} pedido(s) expirado(s) sem pagamento.`);
    },
  },
];

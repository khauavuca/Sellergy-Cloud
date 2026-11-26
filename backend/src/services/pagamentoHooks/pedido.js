// Pedido pago: status PAGO, baixa o estoque (venda) e avisa o cliente.
// cobranca.refId = id do registro de origem.
//
// Chamado uma vez so, na transicao da Cobranca pra PAGO (ver
// services/cobrancaPagamento.js). Mesmo assim e idempotente: pedido que ja
// tem venda nao registra de novo — um segundo pagamento do mesmo pedido (ex.:
// pagou o Pix depois de alguem marcar "pago" na mao) so vira aviso pro negocio
// conferir e devolver.

const prisma = require('../../prisma');
const { registrarPagamento, aposPagamento } = require('../../pedidos/pedidoService');
const { criarNotificacaoTenant } = require('../../utils/notificacoes');

async function aoPagar(cobranca) {
  const r = await registrarPagamento(cobranca.refId, cobranca.clienteId, { automatico: true, metodoPagamento: 'PIX' });
  if (r.jaPago) {
    await criarNotificacaoTenant(prisma, {
      clienteId: cobranca.clienteId,
      tipo: 'GENERICA',
      titulo: `Pagamento em dobro no pedido #${r.pedido.numero}`,
      mensagem: `Chegou um pagamento de R$ ${Number(cobranca.valor).toFixed(2).replace('.', ',')} para um pedido que já estava pago. Confira e devolva ao cliente se for o caso.`,
      link: '/app/pedidos',
    }).catch(() => {});
    return;
  }
  await aposPagamento(r, { automatico: true });
}

module.exports = { aoPagar };

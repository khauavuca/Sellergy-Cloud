// Ganchos chamados quando uma Cobranca do TENANT e paga pela primeira vez
// (ver services/cobrancaPagamento.js#aplicarEfeitoConfirmacao). Cada origem
// tem seu arquivo, pra cada fluxo cuidar so do seu efeito:
//   AGENDAMENTO -> ./agendamento.js  (sinal do horario)
//   PEDIDO      -> ./pedido.js       (pedido do catalogo / WhatsApp)
//   PACOTE      -> ./pacote.js       (parcela de pacote de sessoes)
//   AVULSA      -> ./avulsa.js       (cobranca rapida da tela Hoje vira entrada no caixa)
// Um gancho nunca derruba o webhook: erro vira log + notificacao.

const prisma = require('../../prisma');
const { criarNotificacao } = require('../../utils/notificacoes');

const GANCHOS = {
  AGENDAMENTO: () => require('./agendamento'),
  PEDIDO: () => require('./pedido'),
  PACOTE: () => require('./pacote'),
  AVULSA: () => require('./avulsa'),
};

async function aoConfirmarPagamento(cobranca) {
  const carregar = GANCHOS[cobranca.origem];
  if (!carregar || !cobranca.refId) return;
  try {
    await carregar().aoPagar(cobranca);
  } catch (erro) {
    console.error(`[pagamentoHooks] ${cobranca.origem} ${cobranca.refId}:`, erro?.message || erro);
    await criarNotificacao(prisma, {
      clienteId: cobranca.clienteId, tipo: 'GENERICA',
      titulo: 'Pagamento recebido, confira o registro',
      mensagem: `O pagamento de R$ ${Number(cobranca.valor).toFixed(2).replace('.', ',')} foi confirmado, mas o sistema não conseguiu atualizar tudo sozinho. Confira em Pagamentos.`,
      link: '/app/pagamentos',
    }).catch(() => {});
  }
}

module.exports = { aoConfirmarPagamento };

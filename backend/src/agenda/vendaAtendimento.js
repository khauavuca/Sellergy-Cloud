// Venda gerada pelo "Concluir" de um atendimento — desfazer junto.
//
// Atendimento concluido que volta (cancelou, reabriu, excluiu) nao pode deixar
// a venda valendo: cancela a venda, cancela o lancamento do caixa (o saldo do
// caixa so soma RECEITA PAGO, entao o dinheiro sai da conta), devolve a sessao
// do pacote e estorna a comissao. Tudo dentro da transacao de quem chama.
// Idempotente: venda ja cancelada nao e mexida de novo.

const pacotes = require('./pacotes');
const comissoes = require('./comissoes');

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ agendamentoId: string, clienteId: string, motivo?: string, usuarioId?: string|null }} p
 * @returns {Promise<{ vendaCancelada: null | { id: string, numero: number, valor: number } }>}
 */
async function desfazerConclusao(tx, { agendamentoId, clienteId, motivo = 'Atendimento desfeito na agenda', usuarioId = null }) {
  const venda = await tx.venda.findFirst({
    where: { agendamentoId, clienteId },
    select: { id: true, numero: true, valor: true, status: true },
  });
  let vendaCancelada = null;
  if (venda && venda.status !== 'CANCELLED') {
    const agora = new Date();
    // Atualizacao condicional: dois pedidos ao mesmo tempo, so um cancela.
    const r = await tx.venda.updateMany({
      where: { id: venda.id, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED', dataCancelamento: agora, motivoCancelamento: motivo, canceladaPorId: usuarioId },
    });
    if (r.count > 0) {
      await tx.lancamentoFinanceiro.updateMany({
        where: { vendaId: venda.id, clienteId, status: { not: 'CANCELADO' } },
        data: { status: 'CANCELADO', dataCancelamento: agora, motivoCancelamento: `Cancelamento da venda #${venda.numero} — ${motivo}` },
      });
      vendaCancelada = { id: venda.id, numero: venda.numero, valor: venda.valor };
    }
  }
  await pacotes.estornarSessao(tx, agendamentoId);
  await comissoes.estornarComissaoAtendimento(tx, agendamentoId, { motivo: 'Atendimento cancelado' });
  return { vendaCancelada };
}

module.exports = { desfazerConclusao };

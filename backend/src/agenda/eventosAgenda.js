// Efeitos colaterais de mudancas na agenda (fase 2), num lugar so:
//   - horario liberado (cancelou, remarcou, excluiu, pediu "Remarcar")
//     -> sinal pendente cancelado, vaga pra fila de encaixe, e se era um
//        atendimento concluido: sessao do pacote e comissao estornadas;
//   - venda de atendimento cancelada em Vendas (fora da agenda)
//     -> reconciliarEstornos() devolve a sessao e estorna a comissao.
// Nada aqui lanca: a operacao principal nunca quebra por causa disto.

const prisma = require('../prisma');

/**
 * @param {object} antes agendamento ANTES da mudanca (id, clienteId, data, duracao, especialistaId, servico, status, telefoneCliente, sinalStatus, sinalCobrancaId)
 * @param {{ cancelado?: boolean }} opcoes cancelado=false quando so mudou de horario (remarcacao)
 */
async function aoLiberarHorario(antes, { cancelado = true } = {}) {
  if (!antes) return;
  try {
    if (cancelado) await require('./sinal').cancelarSinalPendente(antes);
    if (antes.status === 'COMPLETED') {
      await require('./pacotes').estornarSessao(prisma, antes.id);
      await require('./comissoes').estornarComissaoAtendimento(prisma, antes.id, { motivo: 'Atendimento cancelado' });
    }
    await require('./encaixe').registrarVaga(antes);
  } catch (e) {
    console.error('[eventosAgenda] aoLiberarHorario', e?.message);
  }
}

/**
 * Venda de atendimento cancelada/estornada em Vendas: devolve a sessao do
 * pacote e estorna a comissao. Idempotente; roda no worker e ao abrir as
 * telas de Comissoes e Pacotes.
 */
async function reconciliarEstornos({ clienteId = null, dias = 90 } = {}) {
  const desde = new Date(Date.now() - dias * 86400000);
  const vendas = await prisma.venda.findMany({
    where: {
      ...(clienteId ? { clienteId } : {}),
      status: { in: ['CANCELLED', 'REFUNDED'] },
      agendamentoId: { not: null },
      OR: [{ dataCancelamento: { gte: desde } }, { dataCancelamento: null, atualizadoEm: { gte: desde } }],
    },
    select: { agendamentoId: true },
    take: 1000,
  });
  let estornos = 0;
  for (const v of vendas) {
    try {
      if (await require('./pacotes').estornarSessao(prisma, v.agendamentoId)) estornos += 1;
      if (await require('./comissoes').estornarComissaoAtendimento(prisma, v.agendamentoId, { motivo: 'Venda cancelada' })) estornos += 1;
    } catch (e) {
      console.error('[eventosAgenda] reconciliar', v.agendamentoId, e?.message);
    }
  }
  return { estornos };
}

module.exports = { aoLiberarHorario, reconciliarEstornos };

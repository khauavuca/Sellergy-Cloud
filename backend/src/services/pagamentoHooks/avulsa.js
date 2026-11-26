// Pix avulso pago. So a "Cobrar rapido" da tela Hoje (refId COBRANCA_RAPIDA)
// vira entrada no caixa: e dinheiro do balcao sem produto escolhido, entao
// entra como receita da sessao de caixa (aberta sozinha se o negocio usa o
// caixa automatico). Idempotente: a mesma cobranca nunca lanca duas vezes.

const prisma = require('../../prisma');
const { obterOuAbrirSessaoCaixa } = require('../caixaAutomatico');

const REF_COBRANCA_RAPIDA = 'COBRANCA_RAPIDA';

async function aoPagar(cobranca) {
  if (cobranca.refId !== REF_COBRANCA_RAPIDA) return;
  const marca = `[cobranca:${cobranca.id}]`;

  await prisma.$transaction(async (tx) => {
    const ja = await tx.lancamentoFinanceiro.findFirst({ where: { clienteId: cobranca.clienteId, descricao: { contains: marca } }, select: { id: true } });
    if (ja) return;

    let sessao = await tx.sessaoCaixa.findFirst({ where: { clienteId: cobranca.clienteId, status: 'ABERTA' }, orderBy: { abertaEm: 'desc' } });
    if (!sessao) {
      const cfg = await tx.cliente.findUnique({ where: { id: cobranca.clienteId }, select: { caixaAutomatico: true } });
      if (cfg?.caixaAutomatico) {
        sessao = (await obterOuAbrirSessaoCaixa(tx, cobranca.clienteId, { motivo: 'Aberto automaticamente ao receber uma cobrança rápida.' })).sessao;
      }
    }

    await tx.lancamentoFinanceiro.create({
      data: {
        clienteId: cobranca.clienteId,
        sessaoCaixaId: sessao?.id || null,
        descricao: `Cobrança rápida por Pix ${marca}`,
        metodoPagamento: 'PIX',
        valor: Number(cobranca.valor),
        tipo: 'RECEITA',
        status: 'PAGO',
        dataVencimento: new Date(),
        dataPagamento: cobranca.pagoEm ? new Date(cobranca.pagoEm) : new Date(),
      },
    });
  });
}

module.exports = { aoPagar, REF_COBRANCA_RAPIDA };

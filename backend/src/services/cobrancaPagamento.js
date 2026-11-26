// Aplicacao idempotente de status de Cobranca + efeito de confirmacao.
// Compartilhado pelo webhook (confirmacao automatica) e pela sincronizacao
// manual — os dois caminhos passam por aqui pra a regra ser unica.

const prisma = require('../prisma');
const { lockClienteAdvisory } = require('../utils/locks');
const { helpers: caixaHelpers } = require('../controllers/CaixaController');
const { criarVenda } = require('./vendaService');
const { resolverPrecoVenda } = require('../produto');
const { criarNotificacaoTenant } = require('../utils/notificacoes');

// Campos seguros pra devolver (sem o payload bruto do PSP).
const CAMPOS_COBRANCA = {
  id: true, origem: true, refId: true, valor: true, metodo: true,
  status: true, provedor: true, provedorCobrancaId: true, qrCode: true,
  linkUrl: true, vencimento: true, pagoEm: true, criadoEm: true, atualizadoEm: true,
};

/**
 * Registra a venda automatica de uma cobranca nascida da ferramenta
 * GERAR_COBRANCA_PIX do bot (origem=VENDA, refId ainda null, itensPendentes
 * preenchido). Reabre/reaproveita o caixa AUTO_BOT (mesmo padrao que a
 * conclusao de agendamento ja usa, com o mesmo lock por tenant) e cria a
 * Venda com baixa de estoque + lancamento financeiro — tudo numa unica
 * transacao: ou persiste tudo, ou nada.
 *
 * Revalida estoque no MOMENTO da confirmacao — nao confia no que foi checado
 * quando o Pix foi gerado, pode ter passado horas e o estoque ter mudado.
 * Sem estoque suficiente, AINDA registra a venda (o cliente ja pagou, o
 * dinheiro e real — recusar registrar seria pior que deixar o estoque
 * negativo) mas notifica o tenant pra conferir.
 */
async function registrarVendaDoBot(cobranca) {
  const itensPendentes = Array.isArray(cobranca.itensPendentes) ? cobranca.itensPendentes : [];
  if (itensPendentes.length === 0) {
    throw new Error('Cobranca sem itensPendentes — nada a registrar.');
  }

  const variacaoIds = itensPendentes.map((i) => i.variacaoId).filter(Boolean);
  const variacoesDb = await prisma.variacaoProduto.findMany({
    where: { id: { in: variacaoIds }, produto: { clienteId: cobranca.clienteId } },
    include: { produto: true },
  });
  const mapaVariacao = new Map(variacoesDb.map((v) => [v.id, v]));

  let estoqueInsuficiente = false;
  const itensValidados = [];
  for (const item of itensPendentes) {
    const v = mapaVariacao.get(item.variacaoId);
    // Variacao sumiu (apagada) entre a criacao do Pix e a confirmacao — pula
    // esse item em vez de derrubar a venda inteira por causa de 1 item.
    if (!v) continue;
    const qtd = Number(item.quantidade) || 0;
    if (qtd <= 0) continue;
    if (v.produto.tipo === 'FISICO' && v.estoqueAtual < qtd) {
      estoqueInsuficiente = true;
    }
    const preco = resolverPrecoVenda(v);
    itensValidados.push({ variacao: v, quantidade: qtd, precoUnitario: preco, subtotal: preco * qtd });
  }

  if (itensValidados.length === 0) {
    throw new Error('Nenhum item valido restante pra registrar a venda (todas as variacoes sumiram).');
  }

  const resultadoVenda = await prisma.$transaction(async (tx) => {
    // Lock advisory: serializa com o cron 00:01 e com aberturas manuais —
    // garante que nao nascem 2 sessoes ABERTA simultaneas pro mesmo tenant.
    await lockClienteAdvisory(tx, cobranca.clienteId);

    let sessao = await caixaHelpers.buscarSessaoAberta(cobranca.clienteId, tx);
    if (!sessao) {
      sessao = await tx.sessaoCaixa.create({
        data: {
          clienteId: cobranca.clienteId,
          fundoCaixa: 0,
          status: 'ABERTA',
          origem: 'AUTO_BOT',
          observacaoAbertura: 'Aberta automaticamente ao confirmar um pagamento via bot.',
        },
      });
    }

    const resultado = await criarVenda({
      clienteId: cobranca.clienteId,
      sessaoCaixaId: sessao.id,
      itensValidados,
      descricaoVenda: `Venda via bot (Pix ${cobranca.id.slice(0, 8)})`,
      tx,
    });

    // Liga a Cobranca a venda que ela gerou — refId deixa de ser null, entao
    // uma re-entrega do webhook (idempotente) nunca mais cai neste caminho
    // pra essa cobranca (ver aplicarEfeitoConfirmacao).
    await tx.cobranca.update({ where: { id: cobranca.id }, data: { refId: resultado.venda.id } });

    return resultado;
  });

  if (estoqueInsuficiente) {
    await criarNotificacaoTenant(prisma, {
      clienteId: cobranca.clienteId,
      tipo: 'GENERICA',
      titulo: 'Venda automatica com estoque insuficiente',
      mensagem: `O bot confirmou um Pix e registrou a venda #${resultadoVenda.venda.numero}, mas o estoque de um ou mais itens ja estava abaixo do vendido. Confira o saldo.`,
      link: '/app/vendas',
    }).catch((e) => console.error('[pagamento] falha ao notificar estoque insuficiente', e?.message));
  }

  return resultadoVenda;
}

// Efeito de confirmacao (a "baixa"). Roda UMA vez, na transicao p/ PAGO.
async function aplicarEfeitoConfirmacao(cobranca) {
  console.log(
    `[pagamento] Cobranca ${cobranca.id} confirmada `
    + `(origem=${cobranca.origem}, ref=${cobranca.refId || '-'}, valor=${cobranca.valor}).`
  );

  // Efeitos por origem (sinal, pedido, pacote): ver services/pagamentoHooks.
  await require('./pagamentoHooks').aoConfirmarPagamento(cobranca);

  // So origem VENDA sem venda ainda (nasceu da ferramenta do bot, com o
  // carrinho pretendido em itensPendentes) dispara a baixa automatica.
  // Origem AGENDAMENTO/AVULSA ou VENDA que ja tem refId (cobranca avulsa de
  // uma venda que ja existia) segue sem efeito aqui — SEAM documentado desde
  // a Frente 2, nao decidido nesta rodada.
  if (cobranca.origem !== 'VENDA' || cobranca.refId || !cobranca.itensPendentes) return;

  try {
    await registrarVendaDoBot(cobranca);
  } catch (erro) {
    // Nunca propaga: o pagamento ja foi confirmado (fato consumado, Cobranca
    // ja esta PAGO) — deixar isso derrubar o webhook so faria o PSP re-tentar
    // uma entrega que, por ser idempotente (ver aplicarStatusCobranca), nunca
    // mais chamaria este codigo de novo (a linha ja esta PAGO). Melhor logar alto
    // e avisar o tenant pra registrar na mao do que perder o rastro.
    console.error(`[pagamento] falha ao registrar venda automatica da cobranca ${cobranca.id}:`, erro?.message || erro);
    await criarNotificacaoTenant(prisma, {
      clienteId: cobranca.clienteId,
      tipo: 'GENERICA',
      titulo: 'Pagamento confirmado, venda nao registrada',
      mensagem: `O Pix da cobranca ${cobranca.id.slice(0, 8)} (R$ ${Number(cobranca.valor).toFixed(2)}) foi confirmado mas a venda nao pode ser criada automaticamente. Registre manualmente.`,
      link: '/app/vendas',
    }).catch((e) => console.error('[pagamento] falha ao notificar falha de venda', e?.message));
  }
}

// De quais status cada status pode vir. Regras:
// - PAGO so vem de PENDENTE/EXPIRADO/CANCELADO (Pix pago depois de vencer
//   ainda e dinheiro na conta) — nunca de ESTORNADO (estorno nao "despaga" e
//   nao reexecuta a baixa);
// - PAGO nao volta para PENDENTE/EXPIRADO/CANCELADO (evento atrasado/fora de
//   ordem); de PAGO so sai para ESTORNADO (estorno ou chargeback);
// - ESTORNADO e final.
const ORIGENS_PERMITIDAS = Object.freeze({
  PAGO: ['PENDENTE', 'EXPIRADO', 'CANCELADO'],
  ESTORNADO: ['PENDENTE', 'EXPIRADO', 'CANCELADO', 'PAGO'],
  EXPIRADO: ['PENDENTE'],
  CANCELADO: ['PENDENTE', 'EXPIRADO'],
  PENDENTE: ['EXPIRADO'],
});

/** A transicao de -> para e permitida? (mesmo status = nao, nada a fazer) */
function transicaoPermitida(de, para) {
  return (ORIGENS_PERMITIDAS[para] || []).includes(de);
}

// Aplica um status na Cobranca de forma IDEMPOTENTE e sem corrida: a escrita e
// condicional (updateMany com o status de origem permitido no where), entao
// dois webhooks simultaneos (ou webhook + "Atualizar" manual) nao rodam a
// baixa duas vezes — so quem mudou a linha (count === 1) dispara o efeito.
async function aplicarStatusCobranca(cobranca, novoStatus, pagoEm) {
  const atual = () => prisma.cobranca.findUnique({ where: { id: cobranca.id }, select: CAMPOS_COBRANCA });
  if (!ORIGENS_PERMITIDAS[novoStatus]) return atual();

  const data = { status: novoStatus };
  if (novoStatus === 'PAGO') data.pagoEm = pagoEm ? new Date(pagoEm) : new Date();

  // Estorno de algo ja PAGO tenta primeiro so a partir de PAGO, pra saber
  // (pelo count, sem confiar no objeto em memoria) se precisa avisar.
  let estornouPago = false;
  if (novoStatus === 'ESTORNADO') {
    const r0 = await prisma.cobranca.updateMany({ where: { id: cobranca.id, status: 'PAGO' }, data });
    estornouPago = r0.count === 1;
  }
  if (!estornouPago) {
    const r = await prisma.cobranca.updateMany({
      where: { id: cobranca.id, status: { in: ORIGENS_PERMITIDAS[novoStatus] } },
      data,
    });
    if (r.count !== 1) return atual(); // ja estava assim, ou transicao proibida
  }

  if (novoStatus === 'PAGO') {
    // Registro COMPLETO (CAMPOS_COBRANCA nao inclui clienteId/itensPendentes).
    const completa = await prisma.cobranca.findUnique({ where: { id: cobranca.id } });
    await aplicarEfeitoConfirmacao(completa);
  } else if (estornouPago) {
    // Estorno/chargeback de algo ja baixado: nao desfaz sozinho (venda,
    // caixa, sinal), avisa o negocio pra conferir.
    await criarNotificacaoTenant(prisma, {
      clienteId: cobranca.clienteId,
      tipo: 'GENERICA',
      titulo: 'Pagamento estornado',
      mensagem: `A cobranca ${String(cobranca.id).slice(0, 8)} (R$ ${Number(cobranca.valor).toFixed(2)}) foi estornada ou contestada no provedor. Confira a venda e o caixa.`,
      link: '/app/pagamentos',
    }).catch((e) => console.error('[pagamento] falha ao notificar estorno', e?.message));
  }
  return atual();
}

module.exports = { aplicarStatusCobranca, aplicarEfeitoConfirmacao, registrarVendaDoBot, transicaoPermitida, CAMPOS_COBRANCA };

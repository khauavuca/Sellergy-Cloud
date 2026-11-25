// Nucleo transacional de venda — extraido de VendaController.registrarVenda
// pra ser reusado pela confirmacao automatica de pagamento do bot
// (services/cobrancaPagamento.js). Quem chama:
//   - ja validou os itens (estoque suficiente, preco resolvido);
//   - ja tem uma sessaoCaixaId valida — como ela foi obtida (exige caixa
//     manual aberto, ou auto-abre AUTO_BOT) e decisao de CADA chamador, nao
//     desta funcao. Isso preserva o comportamento da venda manual (409 se
//     nao tiver caixa aberto) sem duplicar a parte arriscada (baixa de
//     estoque + lancamento financeiro).
//
// Numero sequencial: tirado com trava advisory propria do tenant
// (venda-numero:<clienteId>), entao 2 vendas em paralelo nunca pegam o mesmo
// numero. O retry de P2002 fica so pra quem cria venda sem essa trava
// (conclusao de agendamento).
//
// Estoque: a baixa e CONDICIONAL (estoqueAtual >= quantidade) dentro da
// transacao. Duas vendas do ultimo item em paralelo -> so uma passa; a outra
// recebe ErroVenda 422 e a transacao inteira desfaz. Quem ja recebeu o
// dinheiro antes (bot/pedido pago) passa `exigirEstoque: false` e so e avisado.
//
// Cupom: o uso e incrementado so se ainda houver uso disponivel (mesma
// transacao). Cupom de 1 uso em 10 vendas paralelas -> 1 venda com desconto.

const prisma = require('./../prisma');
const { registrarUsoCupom } = require('./cupomService');
const { fecharLeadAutomatico } = require('./etapaLeadAuto');
const { lockClienteAdvisory } = require('../utils/locks');

const MAX_RETRIES_NUMERO = 5;

/** Erro de regra de negocio da venda (vira 4xx no controller). */
class ErroVenda extends Error {
  constructor(mensagem, { status = 422, codigo, campos } = {}) {
    super(mensagem);
    this.name = 'ErroVenda';
    this.status = status;
    if (codigo) this.codigo = codigo;
    if (campos) this.campos = campos;
  }
}

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Baixa condicional: so desconta se ainda houver saldo. Postgres reavalia o
 * WHERE depois de esperar a trava da linha, entao a corrida e segura.
 * @returns {Promise<boolean>} true se baixou.
 */
async function baixarEstoque(tx, variacaoId, quantidade, { exigirEstoque = true } = {}) {
  const qtd = Math.abs(quantidade);
  if (!exigirEstoque) {
    await tx.variacaoProduto.update({ where: { id: variacaoId }, data: { estoqueAtual: { decrement: qtd } } });
    return true;
  }
  const r = await tx.variacaoProduto.updateMany({
    where: { id: variacaoId, estoqueAtual: { gte: qtd } },
    data: { estoqueAtual: { decrement: qtd } },
  });
  return r.count === 1;
}

/**
 * @param {{
 *   clienteId: string,
 *   sessaoCaixaId: string,
 *   itensValidados: Array<{variacao:Object, quantidade:number, precoUnitario:number, subtotal:number, dataDevolucao?:Date}>,
 *   leadId?: string|null,
 *   metodoPagamento?: string|null,
 *   descricaoVenda: string,
 *   cupomAplicado?: {cupomId:string, valorComDesconto:number}|null,
 *   tx?: Object,
 * }} p
 * `tx`, se informado, roda DENTRO dessa transacao existente (usado pela
 * confirmacao de pagamento, que ja abriu uma transacao pra tambem
 * abrir/reaproveitar o caixa AUTO_BOT com lock). Sem `tx`, abre a propria.
 * `cupomAplicado`: quem chama JA validou o cupom (services/cupomService.js) —
 * aqui so persiste o desconto e incrementa o uso, na mesma transacao da venda.
 * @returns {Promise<{venda:Object, totalItens:number, valorTotal:number, lancamentos:Array, totalLancamentos:number}>}
 */
async function criarVenda({ clienteId, sessaoCaixaId, itensValidados, leadId = null, metodoPagamento = null, descricaoVenda, cupomAplicado = null, especialistaId = null, exigirEstoque = false, tx: txExterna }) {
  // Dinheiro sempre em centavos (0.1 + 0.2 nao vira 0.30000000000000004).
  const valorBruto = centavos(itensValidados.reduce((acc, i) => acc + i.subtotal, 0));
  const valorFinal = cupomAplicado ? centavos(cupomAplicado.valorComDesconto) : valorBruto;
  // Proporcao do desconto — aplicada em cada grupo de lancamento pra soma dos
  // lancamentos bater com o valor de fato recebido (venda.valor), nao com o
  // preco cheio. Sem cupom, fator = 1 (nao muda nada).
  const fatorDesconto = valorBruto > 0 ? valorFinal / valorBruto : 1;

  const corpo = async (tx) => {
    // Trava do numero da venda deste negocio (liberada no fim da transacao).
    await lockClienteAdvisory(tx, `venda-numero:${clienteId}`);
    const venda = await tx.venda.create({
      data: {
        clienteId,
        numero: await proximoNumero(tx, clienteId),
        leadId: leadId || null,
        sessaoCaixaId,
        valor: valorFinal,
        cupomId: cupomAplicado?.cupomId || null,
        valorAntesDesconto: cupomAplicado ? valorBruto : null,
        metodoPagamento: metodoPagamento || null,
        descricao: descricaoVenda,
        especialistaId: especialistaId || null,
        status: 'COMPLETED',
      },
    });

    if (cupomAplicado) {
      const usou = await registrarUsoCupom(tx, cupomAplicado.cupomId);
      if (!usou) {
        throw new ErroVenda('Cupom esgotado (limite de uso atingido) ou não vale mais.', { codigo: 'CUPOM_ESGOTADO', campos: ['cupomCodigo'] });
      }
    }

    for (const it of itensValidados) {
      await tx.movimentacaoEstoque.create({
        data: {
          variacaoId: it.variacao.id,
          tipo: 'VENDA',
          quantidade: -Math.abs(it.quantidade),
          // Congela o custo do momento da venda (custo medio corrente) pra o
          // CMV e o lucro ficarem imutaveis nos relatorios.
          custoUnitario: it.variacao.precoCusto ?? null,
          motivo: `Venda #${venda.numero}`,
          vendaId: venda.id,
        },
      });
      if (it.variacao.produto.tipo === 'FISICO') {
        const baixou = await baixarEstoque(tx, it.variacao.id, it.quantidade, { exigirEstoque });
        if (!baixou) {
          const atual = await tx.variacaoProduto.findUnique({ where: { id: it.variacao.id }, select: { estoqueAtual: true } });
          throw new ErroVenda(
            `Estoque insuficiente em ${it.variacao.produto.nome} (${it.variacao.nome}). Disponível: ${atual?.estoqueAtual ?? 0}, solicitado: ${it.quantidade}.`,
            { codigo: 'ESTOQUE_INSUFICIENTE', campos: ['itens'] },
          );
        }
      }

      // Aluguel/devolucao: so cria o registro quando o produto pede devolucao,
      // veio uma data (validado antes pelo chamador) e ha um cliente
      // identificado (leadId) pra avisar quando a data chegar perto.
      if (it.variacao.produto.temDevolucao && it.dataDevolucao && leadId) {
        await tx.devolucao.create({
          data: {
            clienteId,
            vendaId: venda.id,
            variacaoId: it.variacao.id,
            leadId,
            quantidade: it.quantidade,
            dataDevolucao: it.dataDevolucao,
          },
        });
      }
    }

    // Agrupa por categoria do produto — cada grupo vira 1 LancamentoFinanceiro
    // vinculado a mesma venda, pra relatorios por categoria ficarem precisos
    // quando a venda tem produtos de categorias diferentes.
    const gruposPorCat = new Map();
    for (const it of itensValidados) {
      const catId = it.variacao.produto.categoriaId || null;
      if (!gruposPorCat.has(catId)) gruposPorCat.set(catId, []);
      gruposPorCat.get(catId).push(it);
    }

    const lancamentosCriados = [];
    for (const [catId, itensDoGrupo] of gruposPorCat.entries()) {
      const subtotalGrupo = itensDoGrupo.reduce((acc, i) => acc + i.subtotal, 0);
      // Desconto do cupom rateado proporcionalmente entre os grupos.
      const subtotalComDesconto = centavos(subtotalGrupo * fatorDesconto);
      const detalheItens = itensDoGrupo
        .map((it) => `${it.variacao.produto.nome} (${it.variacao.nome}) x${it.quantidade}`)
        .join(', ');
      const lanc = await tx.lancamentoFinanceiro.create({
        data: {
          clienteId,
          leadId: leadId || null,
          vendaId: venda.id,
          sessaoCaixaId,
          categoriaId: catId,
          descricao: `Receita Venda #${venda.numero}: ${detalheItens}${cupomAplicado ? ' (com cupom)' : ''}`,
          valor: subtotalComDesconto,
          tipo: 'RECEITA',
          status: 'PAGO',
          // Sem isto o Caixa mostrava "Não informada" mesmo com a venda em Pix/Dinheiro.
          metodoPagamento: metodoPagamento || null,
          dataVencimento: new Date(),
          dataPagamento: new Date(),
        },
      });
      lancamentosCriados.push(lanc);
    }

    // Pagamento concluido = lead fechado no funil, seja produto, aluguel ou
    // servico (agendamento concluido tambem passa por aqui — ver
    // Venda.agendamentoId). Reabertura fica por conta do aviso de devolucao
    // proxima ou de um novo contato do cliente (etapaLeadAuto.js).
    if (leadId) {
      await fecharLeadAutomatico(tx, {
        clienteId,
        leadId,
        motivo: `Fechado automaticamente: venda #${venda.numero} concluída.`,
      });
    }

    return {
      venda,
      totalItens: itensValidados.length,
      valorTotal: valorFinal,
      lancamentos: lancamentosCriados,
      totalLancamentos: lancamentosCriados.length,
    };
  };

  // Ja dentro de uma transacao externa (confirmacao de pagamento): so roda o
  // corpo, sem retry proprio — o chamador controla o retry/lock dele.
  if (txExterna) return corpo(txExterna);

  // Sem transacao externa (venda manual): abre a propria, com retry de numero.
  let tentativa = 0;
  while (true) {
    try {
      return await prisma.$transaction((tx) => corpo(tx));
    } catch (err) {
      if (err?.code === 'P2002' && tentativa < MAX_RETRIES_NUMERO) {
        tentativa += 1;
        continue;
      }
      throw err;
    }
  }
}

/** Proximo numero do negocio. Chamar DENTRO da transacao, depois da trava. */
async function proximoNumero(tx, clienteId) {
  const ultima = await tx.venda.findFirst({
    where: { clienteId }, orderBy: { numero: 'desc' }, select: { numero: true },
  });
  return (ultima?.numero || 0) + 1;
}

module.exports = { criarVenda, ErroVenda, baixarEstoque, proximoNumero, centavos };

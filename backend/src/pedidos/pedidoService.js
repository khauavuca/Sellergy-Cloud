// =====================================================================
// PEDIDOS — servico (banco + PSP + WhatsApp).
// =====================================================================
// Ciclo:
//   NOVO (loja online) ──aceitar──> AGUARDANDO_PAGAMENTO ──pago──> PAGO ──> ENTREGUE
//        └──────────── marcar como pago (dinheiro na retirada) ──┘
//   NOVO/AGUARDANDO ──cancelar ou 24 h sem pagar──> CANCELADO
//
// Estoque so baixa quando vira PAGO (venda registrada pelo vendaService, com
// caixa automatico) — cancelar nao devolve nada porque nada saiu.
// Numero sequencial por tenant: criado dentro de uma transacao com lock
// advisory proprio do tenant (pedido:<clienteId>), entao dois pedidos
// simultaneos nunca pegam o mesmo numero.
// =====================================================================

const crypto = require('crypto');
const prisma = require('../prisma');
const { lockClienteAdvisory } = require('../utils/locks');
const { obterOuAbrirSessaoCaixa } = require('../services/caixaAutomatico');
const { criarVenda } = require('../services/vendaService');
const { criarCobranca } = require('../services/pagamentoService');
const { enviarMensagemTenant } = require('../services/mensagemTenant');
const { criarNotificacaoTenant } = require('../utils/notificacoes');
const {
  STATUS, podeIr, origensPara, normalizarItens, recalcularPedido, validarContato,
  ErroPedido, textos, linkPedido, brl, HORAS_PARA_EXPIRAR,
} = require('./regras');

const MAX_RETENTATIVAS = 5;

function baseUrlPublica() {
  return (process.env.APP_URL_PUBLICA || process.env.VITE_URL_PUBLICA || 'http://localhost:5173').replace(/\/$/, '');
}

function gerarToken() {
  return crypto.randomBytes(18).toString('base64url');
}

async function nomeDoNegocio(clienteId) {
  const c = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, brandNome: true } });
  return c?.brandNome || c?.nome || 'loja';
}

/** Proximo numero do tenant. Chamar DENTRO da transacao, depois do lock. */
async function proximoNumero(tx, clienteId) {
  const ultimo = await tx.pedido.findFirst({ where: { clienteId }, orderBy: { numero: 'desc' }, select: { numero: true } });
  return (ultimo?.numero || 0) + 1;
}

async function lockPedidos(tx, clienteId) {
  await lockClienteAdvisory(tx, `pedido:${clienteId}`);
}

/** Variacoes do tenant (com produto) indexadas por id. */
async function carregarVariacoes(client, clienteId, ids) {
  const lista = await client.variacaoProduto.findMany({
    where: { id: { in: ids }, produto: { clienteId } },
    select: {
      id: true, nome: true, preco: true, precoCusto: true, estoqueAtual: true,
      produto: { select: { id: true, nome: true, tipo: true, visibilidade: true, categoriaId: true, temDevolucao: true } },
    },
  });
  return new Map(lista.map((v) => [v.id, v]));
}

/** Lead pelo telefone (8 ultimos digitos) ou cria. Guarda o CPF se veio. */
async function leadDoContato(tx, clienteId, { nome, telefone, cpf }, origem) {
  const candidatos = await tx.lead.findMany({
    where: { clienteId, telefone: { contains: telefone.slice(-8) } },
    select: { id: true, telefone: true, cpf: true },
    take: 20,
  });
  let lead = candidatos.find((l) => String(l.telefone || '').replace(/\D/g, '').slice(-8) === telefone.slice(-8)) || null;
  if (!lead) {
    lead = await tx.lead.create({ data: { clienteId, nome, telefone, cpf: cpf || null, origem, valor: 0 }, select: { id: true, cpf: true } });
  } else if (cpf && !lead.cpf) {
    await tx.lead.update({ where: { id: lead.id }, data: { cpf } });
  }
  return lead.id;
}

/**
 * Cria o pedido. Preco, frete e total recalculados aqui (o corpo so traz
 * variacaoId + quantidade). Estoque conferido; nada e baixado.
 * @param {{clienteId:string, origem:'CATALOGO'|'WHATSAPP', entrada:Object, config:Object, exigeCpf?:boolean, freteManual?:number|null}} p
 */
async function criarPedido({ clienteId, origem, entrada, config, exigeCpf = false, freteManual = null }) {
  const itensPedidos = normalizarItens(entrada.itens);
  const entrega = entrada.entrega === 'ENTREGA' ? 'ENTREGA' : 'RETIRADA';
  const contato = validarContato(entrada, { exigeCpf, entrega });
  const regras = {
    entrega,
    aceitaRetirada: origem === 'CATALOGO' ? config.aceitaRetirada !== false : true,
    aceitaEntrega: origem === 'CATALOGO' ? config.aceitaEntrega === true : true,
    freteEntrega: config.freteEntrega,
    pedidoMinimo: origem === 'CATALOGO' ? config.pedidoMinimo : null,
    freteManual: origem === 'CATALOGO' ? null : freteManual,
  };

  for (let tentativa = 0; ; tentativa += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockPedidos(tx, clienteId);
        // Recalcula DENTRO da transacao: preco e estoque do momento do pedido.
        const variacoes = await carregarVariacoes(tx, clienteId, itensPedidos.map((i) => i.variacaoId));
        const calc = recalcularPedido(itensPedidos, variacoes, regras);
        const leadId = await leadDoContato(tx, clienteId, contato, origem === 'CATALOGO' ? 'CATALOGO_ONLINE' : 'WHATSAPP');
        return tx.pedido.create({
          data: {
            clienteId,
            numero: await proximoNumero(tx, clienteId),
            leadId,
            nomeCliente: contato.nome,
            telefone: contato.telefone,
            itens: calc.itens,
            subtotal: calc.subtotal,
            frete: calc.frete,
            total: calc.total,
            entrega: calc.entrega,
            endereco: contato.endereco,
            observacao: contato.observacao,
            origem,
            status: STATUS.NOVO,
            tokenPublico: gerarToken(),
          },
        });
      });
    } catch (e) {
      // Colisao de numero/token (nao deveria, por causa do lock) -> tenta de novo.
      if (e?.code === 'P2002' && tentativa < MAX_RETENTATIVAS) continue;
      throw e;
    }
  }
}

/** Mensagem pro cliente final; nunca derruba o fluxo. */
async function avisarCliente(pedido, texto) {
  try {
    return await enviarMensagemTenant({ clienteId: pedido.clienteId, para: pedido.telefone, texto, tipo: 'conversa' });
  } catch (e) {
    console.error(`[pedidos] falha ao avisar cliente do pedido ${pedido.id}:`, e?.message);
    return { ok: false, motivo: 'FALHA' };
  }
}

async function avisarNegocio(pedido, { titulo, mensagem }) {
  await criarNotificacaoTenant(prisma, {
    clienteId: pedido.clienteId, tipo: 'GENERICA', titulo, mensagem, link: '/app/pedidos', dados: { pedidoId: pedido.id },
  }).catch((e) => console.error('[pedidos] falha ao notificar', e?.message));
}

/** Depois de criar pela loja: avisa o negocio e confirma pro cliente. */
async function aposPedidoDaLoja(pedido) {
  const negocio = await nomeDoNegocio(pedido.clienteId);
  await avisarNegocio(pedido, {
    titulo: `Pedido novo #${pedido.numero}`,
    mensagem: `${pedido.nomeCliente} pediu ${brl(pedido.total)} pela loja online. Aceite pra mandar o Pix.`,
  });
  await avisarCliente(pedido, textos.recebido({ pedido, negocio, link: linkPedido(baseUrlPublica(), pedido.tokenPublico) }));
}

async function pedidoDoTenant(clienteId, id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return prisma.pedido.findFirst({ where: { id, clienteId } });
}

/**
 * Muda o status so se ainda estiver num status de origem valido (atomico:
 * dois cliques/um webhook ao mesmo tempo, so um passa).
 */
async function mudarStatus(pedido, para, dadosExtras = {}) {
  if (!podeIr(pedido.status, para)) {
    throw new ErroPedido('Esse pedido não pode mais ir para esse passo.', { status: 409, codigo: 'TRANSICAO_INVALIDA' });
  }
  const r = await prisma.pedido.updateMany({
    where: { id: pedido.id, clienteId: pedido.clienteId, status: { in: origensPara(para) } },
    data: { status: para, ...dadosExtras },
  });
  if (r.count === 0) throw new ErroPedido('O pedido mudou enquanto você mexia. Atualize a tela.', { status: 409, codigo: 'TRANSICAO_INVALIDA' });
  return prisma.pedido.findUnique({ where: { id: pedido.id } });
}

/** Pagador pro PSP (o Asaas pede CPF): vem do lead do pedido. */
async function pagadorDoPedido(pedido) {
  const lead = pedido.leadId
    ? await prisma.lead.findFirst({ where: { id: pedido.leadId, clienteId: pedido.clienteId }, select: { cpf: true, email: true } })
    : null;
  return { nome: pedido.nomeCliente, telefone: pedido.telefone, cpfCnpj: lead?.cpf || undefined, email: lead?.email || undefined };
}

/**
 * Aceita o pedido: cria a cobranca no PSP do tenant (origem PEDIDO,
 * refId = pedido.id), guarda o link e manda no WhatsApp do cliente.
 * Serve tambem pra "reenviar cobranca" (gera uma nova se a anterior caiu).
 */
async function aceitarECobrar(pedido, { metodo = 'PIX' } = {}) {
  if (!podeIr(pedido.status, STATUS.AGUARDANDO_PAGAMENTO)) {
    throw new ErroPedido('Esse pedido não está esperando pagamento.', { status: 409, codigo: 'TRANSICAO_INVALIDA' });
  }
  const negocio = await nomeDoNegocio(pedido.clienteId);

  // Reaproveita a cobranca pendente (reenvio) em vez de gerar outra.
  let cobranca = pedido.cobrancaId
    ? await prisma.cobranca.findFirst({ where: { id: pedido.cobrancaId, clienteId: pedido.clienteId } })
    : null;
  if (!cobranca || cobranca.status !== 'PENDENTE') {
    cobranca = await criarCobranca({
      clienteId: pedido.clienteId,
      origem: 'PEDIDO',
      refId: pedido.id,
      valor: pedido.total,
      metodo: metodo === 'LINK' ? 'LINK' : 'PIX',
      descricao: `Pedido #${pedido.numero} — ${negocio}`.slice(0, 120),
      pagador: await pagadorDoPedido(pedido),
    });
  }

  const atualizado = await mudarStatus(pedido, STATUS.AGUARDANDO_PAGAMENTO, {
    cobrancaId: cobranca.id,
    linkPagamento: cobranca.linkUrl || null,
  });
  const link = linkPedido(baseUrlPublica(), atualizado.tokenPublico);
  const texto = textos.cobranca({ pedido: atualizado, negocio, link, pix: cobranca.qrCode });
  const envio = await avisarCliente(atualizado, texto);
  return { pedido: atualizado, cobranca, mensagem: texto, whatsapp: envio };
}

/**
 * Registra a Venda do pedido (baixa estoque, lancamento, caixa) e marca PAGO.
 * Idempotente: se o pedido ja tem venda, nao faz nada.
 * @param {{automatico?:boolean, metodoPagamento?:string}} opcoes
 *   automatico = veio do PSP (abre o caixa sempre, mesmo com caixa
 *   automatico desligado: o dinheiro ja entrou). Manual respeita a escolha.
 * @returns {Promise<{pedido:Object, venda:Object|null, jaPago:boolean, estoqueInsuficiente:boolean}>}
 */
async function registrarPagamento(pedidoId, clienteId, { automatico = false, metodoPagamento = 'PIX' } = {}) {
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Mesmo lock do caixa: serializa com abertura/fechamento e com outra
        // confirmacao do mesmo tenant.
        await lockClienteAdvisory(tx, clienteId);
        const pedido = await tx.pedido.findFirst({ where: { id: pedidoId, clienteId } });
        if (!pedido) throw new ErroPedido('Pedido não encontrado.', { status: 404, codigo: 'NAO_ENCONTRADO' });
        if (pedido.vendaId) return { pedido, venda: null, jaPago: true, estoqueInsuficiente: false };
        // Pagamento automatico chega mesmo num pedido cancelado/expirado (o
        // Pix ainda valia): o dinheiro e real, entao registra do mesmo jeito.
        if (!automatico && !podeIr(pedido.status, STATUS.PAGO)) {
          throw new ErroPedido('Esse pedido não pode ser marcado como pago.', { status: 409, codigo: 'TRANSICAO_INVALIDA' });
        }

        let sessao;
        if (automatico) {
          sessao = (await obterOuAbrirSessaoCaixa(tx, clienteId, { motivo: 'Aberto automaticamente ao confirmar o pagamento de um pedido.' })).sessao;
        } else {
          sessao = await tx.sessaoCaixa.findFirst({ where: { clienteId, status: 'ABERTA' }, orderBy: { abertaEm: 'desc' } });
          if (!sessao) {
            const cfg = await tx.cliente.findUnique({ where: { id: clienteId }, select: { caixaAutomatico: true } });
            if (!cfg?.caixaAutomatico) {
              throw new ErroPedido('Abra o caixa antes de marcar como pago. Ele fica em Financeiro · Caixa.', { status: 409, codigo: 'CAIXA_FECHADO' });
            }
            sessao = (await obterOuAbrirSessaoCaixa(tx, clienteId)).sessao;
          }
        }

        const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
        const variacoes = await carregarVariacoes(tx, clienteId, itens.map((i) => i.variacaoId));
        let estoqueInsuficiente = false;
        const itensValidados = [];
        for (const it of itens) {
          const v = variacoes.get(it.variacaoId);
          if (!v) continue; // variacao apagada depois do pedido: nao tem o que baixar
          const qtd = Number(it.quantidade) || 0;
          if (qtd <= 0) continue;
          if (v.produto.tipo === 'FISICO' && v.estoqueAtual < qtd) estoqueInsuficiente = true;
          // Preco congelado no pedido: e o que o cliente pagou.
          const preco = Number(it.precoUnitario) || 0;
          itensValidados.push({ variacao: v, quantidade: qtd, precoUnitario: preco, subtotal: Math.round(preco * qtd * 100) / 100 });
        }
        if (itensValidados.length === 0) {
          throw new ErroPedido('Os produtos deste pedido foram apagados do catálogo. Registre a venda pela tela de Vendas.', { status: 409, codigo: 'SEM_ITENS' });
        }

        const resultado = await criarVenda({
          clienteId,
          sessaoCaixaId: sessao.id,
          itensValidados,
          leadId: pedido.leadId,
          metodoPagamento,
          descricaoVenda: `Pedido #${pedido.numero} (${pedido.origem === 'CATALOGO' ? 'loja online' : 'WhatsApp'})`,
          tx,
        });

        // Frete entra no caixa como receita propria da mesma venda.
        if (pedido.frete > 0) {
          await tx.lancamentoFinanceiro.create({
            data: {
              clienteId,
              leadId: pedido.leadId || null,
              vendaId: resultado.venda.id,
              sessaoCaixaId: sessao.id,
              descricao: `Entrega do pedido #${pedido.numero} (venda #${resultado.venda.numero})`,
              valor: pedido.frete,
              tipo: 'RECEITA',
              status: 'PAGO',
              dataVencimento: new Date(),
              dataPagamento: new Date(),
            },
          });
        }

        const atualizado = await tx.pedido.update({
          where: { id: pedido.id },
          data: { status: STATUS.PAGO, pagoEm: new Date(), vendaId: resultado.venda.id, canceladoEm: null },
        });
        return { pedido: atualizado, venda: resultado.venda, jaPago: false, estoqueInsuficiente, estavaCancelado: pedido.status === STATUS.CANCELADO };
      });
    } catch (e) {
      if (e?.code === 'P2002' && tentativa < MAX_RETENTATIVAS) continue; // numero da venda colidiu
      throw e;
    }
  }
}

/** Efeitos depois do pagamento (fora da transacao). */
async function aposPagamento(resultado, { automatico }) {
  const { pedido, venda, estoqueInsuficiente, estavaCancelado } = resultado;
  if (!venda) return;
  await avisarCliente(pedido, textos.pago({ pedido }));
  await avisarNegocio(pedido, {
    titulo: `Pedido #${pedido.numero} pago`,
    mensagem: `${automatico ? 'Pagamento confirmado' : 'Marcado como pago'}: ${brl(pedido.total)}. Venda #${venda.numero} lançada e estoque baixado. Pode separar.`,
  });
  if (estoqueInsuficiente) {
    await avisarNegocio(pedido, {
      titulo: 'Pedido pago com estoque insuficiente',
      mensagem: `O pedido #${pedido.numero} foi pago, mas um ou mais itens já estavam abaixo do vendido. Confira o estoque.`,
    });
  }
  if (estavaCancelado) {
    await avisarNegocio(pedido, {
      titulo: 'Pagamento de pedido cancelado',
      mensagem: `O pedido #${pedido.numero} estava cancelado, mas o cliente pagou. Ele voltou para "Pago · separar".`,
    });
  }
}

async function marcarComoPago(pedido, { metodoPagamento = 'DINHEIRO' } = {}) {
  const metodo = ['DINHEIRO', 'PIX', 'CREDITO', 'DEBITO'].includes(metodoPagamento) ? metodoPagamento : 'DINHEIRO';
  const r = await registrarPagamento(pedido.id, pedido.clienteId, { automatico: false, metodoPagamento: metodo });
  if (r.jaPago) throw new ErroPedido('Esse pedido já está pago.', { status: 409, codigo: 'JA_PAGO' });
  await aposPagamento(r, { automatico: false });
  return r;
}

async function entregar(pedido) {
  const atualizado = await mudarStatus(pedido, STATUS.ENTREGUE, { entregueEm: new Date() });
  await avisarCliente(atualizado, textos.entregue({ pedido: atualizado }));
  return atualizado;
}

async function cancelar(pedido, { motivo, avisar = true, expirou = false } = {}) {
  const atualizado = await mudarStatus(pedido, STATUS.CANCELADO, {
    canceladoEm: new Date(),
    observacao: motivo ? `${pedido.observacao ? `${pedido.observacao}\n` : ''}Cancelado: ${motivo}`.slice(0, 600) : pedido.observacao,
  });
  if (avisar) {
    await avisarCliente(atualizado, expirou ? textos.expirado({ pedido: atualizado }) : textos.cancelado({ pedido: atualizado, motivo }));
  }
  return atualizado;
}

/** Cancela quem passou de 24 h sem pagar. Devolve quantos expiraram. */
async function expirarPedidosVencidos({ agora = new Date(), limite = 200 } = {}) {
  const corte = new Date(agora.getTime() - HORAS_PARA_EXPIRAR * 3600 * 1000);
  const vencidos = await prisma.pedido.findMany({
    where: { status: { in: [STATUS.NOVO, STATUS.AGUARDANDO_PAGAMENTO] }, criadoEm: { lt: corte } },
    orderBy: { criadoEm: 'asc' },
    take: limite,
  });
  let expirados = 0;
  for (const p of vencidos) {
    try {
      await cancelar(p, { motivo: `sem pagamento em ${HORAS_PARA_EXPIRAR} horas`, expirou: true });
      expirados += 1;
    } catch (e) {
      if (e?.codigo !== 'TRANSICAO_INVALIDA') console.error(`[pedidos/expirar] ${p.id}:`, e?.message);
    }
  }
  return { expirados };
}

module.exports = {
  criarPedido,
  aposPedidoDaLoja,
  aceitarECobrar,
  registrarPagamento,
  aposPagamento,
  marcarComoPago,
  entregar,
  cancelar,
  expirarPedidosVencidos,
  pedidoDoTenant,
  proximoNumero,
  carregarVariacoes,
  baseUrlPublica,
  nomeDoNegocio,
};

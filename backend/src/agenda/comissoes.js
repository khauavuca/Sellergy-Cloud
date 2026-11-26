// =====================================================================
// COMISSOES DA EQUIPE
// =====================================================================
// Regra por profissional (Especialista): % dos servicos, % dos produtos e/ou
// valor fixo por atendimento.
//   ATENDIMENTO  gerada ao concluir o agendamento (1 por agendamento:
//                @@unique([agendamentoId, tipo])). Base = preco cheio do
//                servico (sinal nao muda a base); atendimento por pacote usa o
//                valor de 1 sessao do pacote.
//   PRODUTO      o PDV ainda nao registra quem vendeu (Venda nao tem
//                vendedor), entao nao ha comissao de produto automatica. A %
//                fica guardada pra quando o PDV tiver esse dado.
//   VALE         adiantamento (valor negativo), lancado na tela.
//   AJUSTE       estorno de comissao ja paga (valor negativo no mes atual).
// Estorno: atendimento concluido que volta a cancelado, ou venda do
// atendimento cancelada -> A_PAGAR vira CANCELADA; PAGA gera um AJUSTE.
// =====================================================================

const prisma = require('../prisma');
const { round2, brl, competenciaBRT, servicoBase } = require('./utilAgenda');

// ---------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------

function calcularComissaoAtendimento({ pct = 0, fixa = 0, base = 0 }) {
  const p = Number(pct) || 0;
  const f = Number(fixa) || 0;
  const b = Math.max(0, Number(base) || 0);
  return round2(b * p / 100 + f);
}

function temRegra(esp) {
  return (Number(esp?.comissaoServicoPct) || 0) > 0 || (Number(esp?.comissaoFixa) || 0) > 0 || (Number(esp?.comissaoProdutoPct) || 0) > 0;
}

function regraTexto(esp) {
  const partes = [];
  if (Number(esp?.comissaoServicoPct) > 0) partes.push(`${String(esp.comissaoServicoPct).replace('.', ',')}% dos serviços`);
  if (Number(esp?.comissaoFixa) > 0) partes.push(`${brl(esp.comissaoFixa)} por atendimento`);
  if (Number(esp?.comissaoProdutoPct) > 0) partes.push(`${String(esp.comissaoProdutoPct).replace('.', ',')}% dos produtos`);
  return partes.length ? partes.join(' · ') : 'Sem regra de comissão';
}

/**
 * Fechamento de uma pessoa no mes: linhas agrupadas por servico, vales,
 * ajustes e totais. Ignora CANCELADA.
 */
function resumirPessoa(comissoes) {
  const validas = comissoes.filter((c) => c.status !== 'CANCELADA');
  const grupos = new Map();
  const vales = [];
  const ajustes = [];
  for (const c of validas) {
    if (c.tipo === 'VALE') { vales.push(c); continue; }
    if (c.tipo === 'AJUSTE') { ajustes.push(c); continue; }
    const chave = c.tipo === 'PRODUTO' ? '__produtos__' : servicoBase(c.descricao) || '__atendimentos__';
    const g = grupos.get(chave) || { titulo: c.tipo === 'PRODUTO' ? 'Produtos vendidos' : (String(c.descricao || 'Atendimentos').split(/\s+[-—]\s+/)[0]), quantidade: 0, base: 0, valor: 0 };
    g.quantidade += 1;
    g.base = round2(g.base + (c.base || 0));
    g.valor = round2(g.valor + c.valor);
    grupos.set(chave, g);
  }
  const soma = (lista) => round2(lista.reduce((s, c) => s + c.valor, 0));
  return {
    linhas: [...grupos.values()].sort((a, b) => b.valor - a.valor),
    vales: vales.map((v) => ({ id: v.id, descricao: v.descricao, valor: v.valor, criadoEm: v.criadoEm, status: v.status })),
    ajustes: ajustes.map((v) => ({ id: v.id, descricao: v.descricao, valor: v.valor, criadoEm: v.criadoEm, status: v.status })),
    baseServicos: round2(validas.filter((c) => c.tipo === 'ATENDIMENTO').reduce((s, c) => s + (c.base || 0), 0)),
    total: soma(validas),
    pago: soma(validas.filter((c) => c.status === 'PAGA')),
    aPagar: soma(validas.filter((c) => c.status === 'A_PAGAR')),
    atendimentos: validas.filter((c) => c.tipo === 'ATENDIMENTO').length,
  };
}

// ---------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------

/**
 * Gera a comissao do atendimento (dentro da transacao do "Concluir").
 * Idempotente: se ja existe pro agendamento, devolve a existente (reativa
 * se tinha sido cancelada).
 */
async function gerarComissaoAtendimento(tx, { agendamento, base, quando = new Date() }) {
  if (!agendamento.especialistaId) return null;
  const esp = await tx.especialista.findFirst({
    where: { id: agendamento.especialistaId, clienteId: agendamento.clienteId },
    select: { comissaoServicoPct: true, comissaoFixa: true },
  });
  if (!esp) return null;
  const valor = calcularComissaoAtendimento({ pct: esp.comissaoServicoPct, fixa: esp.comissaoFixa, base });
  if (valor <= 0) return null;
  const existente = await tx.comissao.findUnique({ where: { agendamentoId_tipo: { agendamentoId: agendamento.id, tipo: 'ATENDIMENTO' } } });
  if (existente) {
    if (existente.status === 'CANCELADA') {
      return tx.comissao.update({ where: { id: existente.id }, data: { status: 'A_PAGAR', valor, base: round2(base), competencia: competenciaBRT(quando) } });
    }
    return existente;
  }
  return tx.comissao.create({
    data: {
      clienteId: agendamento.clienteId, especialistaId: agendamento.especialistaId, tipo: 'ATENDIMENTO',
      agendamentoId: agendamento.id, descricao: agendamento.servico || `Atendimento de ${agendamento.nomeCliente}`,
      base: round2(base), valor, competencia: competenciaBRT(quando), status: 'A_PAGAR',
    },
  });
}

/**
 * Comissao de uma venda feita no caixa por uma profissional (Venda.especialistaId).
 * Produto fisico usa comissaoProdutoPct; servico vendido no caixa usa
 * comissaoServicoPct. Base = valor pago de cada item (ja com desconto).
 * Idempotente por venda.
 * @param {{ venda: { id, clienteId, numero, especialistaId }, itens: Array<{ tipo: 'FISICO'|'SERVICO'|string, valor: number }> }} p
 */
async function gerarComissaoVenda(client, { venda, itens, quando = new Date() }) {
  if (!venda?.especialistaId) return null;
  const esp = await client.especialista.findFirst({
    where: { id: venda.especialistaId, clienteId: venda.clienteId },
    select: { comissaoProdutoPct: true, comissaoServicoPct: true },
  });
  if (!esp) return null;
  let base = 0;
  let valor = 0;
  for (const it of itens || []) {
    const pct = it.tipo === 'SERVICO' ? Number(esp.comissaoServicoPct) || 0 : Number(esp.comissaoProdutoPct) || 0;
    if (pct <= 0) continue;
    base += Number(it.valor) || 0;
    valor += ((Number(it.valor) || 0) * pct) / 100;
  }
  valor = round2(valor);
  if (valor <= 0) return null;
  const existente = await client.comissao.findUnique({ where: { vendaId_tipo: { vendaId: venda.id, tipo: 'PRODUTO' } } });
  if (existente) return existente;
  return client.comissao.create({
    data: {
      clienteId: venda.clienteId, especialistaId: venda.especialistaId, tipo: 'PRODUTO', vendaId: venda.id,
      descricao: `Venda #${venda.numero} no caixa`, base: round2(base), valor, competencia: competenciaBRT(quando), status: 'A_PAGAR',
    },
  });
}

/** Venda cancelada: estorna a comissao de produto (desconta se ja foi paga). */
async function estornarComissaoVenda(client, vendaId) {
  const c = await client.comissao.findUnique({ where: { vendaId_tipo: { vendaId, tipo: 'PRODUTO' } } });
  if (!c || c.status === 'CANCELADA') return null;
  if (c.status === 'A_PAGAR') return client.comissao.update({ where: { id: c.id }, data: { status: 'CANCELADA' } });
  const ja = await client.comissao.findUnique({ where: { vendaId_tipo: { vendaId, tipo: 'AJUSTE' } } });
  if (ja) return ja;
  return client.comissao.create({
    data: {
      clienteId: c.clienteId, especialistaId: c.especialistaId, tipo: 'AJUSTE', vendaId,
      descricao: `Estorno: ${c.descricao || 'venda'} (venda cancelada)`, base: 0, valor: -Math.abs(c.valor),
      competencia: competenciaBRT(), status: 'A_PAGAR',
    },
  });
}

/** Estorna a comissao de um atendimento desfeito. Idempotente. */
async function estornarComissaoAtendimento(client, agendamentoId, { motivo = 'Atendimento desfeito' } = {}) {
  const c = await client.comissao.findUnique({ where: { agendamentoId_tipo: { agendamentoId, tipo: 'ATENDIMENTO' } } });
  if (!c || c.status === 'CANCELADA') return null;
  if (c.status === 'A_PAGAR') {
    return client.comissao.update({ where: { id: c.id }, data: { status: 'CANCELADA' } });
  }
  // Ja paga: desconta no mes atual (1 ajuste por agendamento).
  const ja = await client.comissao.findUnique({ where: { agendamentoId_tipo: { agendamentoId, tipo: 'AJUSTE' } } });
  if (ja) return ja;
  return client.comissao.create({
    data: {
      clienteId: c.clienteId, especialistaId: c.especialistaId, tipo: 'AJUSTE', agendamentoId,
      descricao: `Estorno: ${c.descricao || 'atendimento'} (${motivo.toLowerCase()})`, base: 0, valor: -Math.abs(c.valor),
      competencia: competenciaBRT(), status: 'A_PAGAR',
    },
  });
}

module.exports = {
  gerarComissaoVenda,
  estornarComissaoVenda,
  calcularComissaoAtendimento, temRegra, regraTexto, resumirPessoa,
  gerarComissaoAtendimento, estornarComissaoAtendimento,
};

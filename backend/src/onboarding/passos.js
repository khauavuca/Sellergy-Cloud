// =====================================================================
// ASSISTENTE DE INICIO — passos por segmento, calculados dos dados reais.
// =====================================================================
// Nao guarda "passo concluido" em lugar nenhum: o passo esta feito quando o
// dado existe (tem produto? tem venda?). Assim o checklist nunca mente nem
// fica dessincronizado se o cliente fizer o passo por outra tela.
//
// Meta da Fase 1: cliente novo faz a primeira venda (loja) ou o primeiro
// agendamento (clinica) em menos de 24 h, sem falar com ninguem.
// =====================================================================

const prisma = require('../prisma');

// Catalogo de passos. `rota` = onde o front leva o cliente pra fazer.
const PASSOS = Object.freeze({
  horario: { titulo: 'Defina o horário de funcionamento', rota: '/app/configuracoes', concluido: (c) => c.temHorario },
  profissionais: { titulo: 'Cadastre quem atende', rota: '/app/usuarios', concluido: (c) => c.profissionais > 0 },
  servicos: { titulo: 'Cadastre seus serviços com preço e duração', rota: '/app/catalogo', concluido: (c) => c.servicos > 0 },
  produtos: { titulo: 'Cadastre seus produtos (ou importe a planilha)', rota: '/app/importar?tipo=produtos', concluido: (c) => c.produtosFisicos > 0 },
  clientes: { titulo: 'Traga seus clientes (importe a planilha)', rota: '/app/importar?tipo=clientes', concluido: (c) => c.clientes > 0 },
  primeiroAgendamento: { titulo: 'Marque o primeiro atendimento', rota: '/app/agenda', concluido: (c) => c.agendamentos > 0 },
  primeiraVenda: { titulo: 'Registre a primeira venda', rota: '/app/vendas', concluido: (c) => c.vendas > 0 },
  whatsapp: { titulo: 'Conecte o WhatsApp do negócio', rota: '/app/bots', concluido: (c) => c.whatsappConectado },
  pagamento: { titulo: 'Ative o recebimento por Pix e link', rota: '/app/pagamentos', concluido: (c) => c.pagamentoConfigurado },
  linkAgendamento: { titulo: 'Divulgue seu link de agendamento', rota: '/app/agenda', concluido: (c) => c.agendamentosPeloLink > 0 },
});

const ORDEM_POR_SEGMENTO = Object.freeze({
  SERVICO: ['horario', 'profissionais', 'servicos', 'clientes', 'primeiroAgendamento', 'whatsapp', 'linkAgendamento', 'pagamento'],
  PRODUTO: ['produtos', 'clientes', 'primeiraVenda', 'pagamento', 'whatsapp'],
  HIBRIDO: ['horario', 'produtos', 'profissionais', 'servicos', 'clientes', 'primeiraVenda', 'primeiroAgendamento', 'whatsapp', 'pagamento'],
});

/**
 * Regra pura: monta o checklist a partir das contagens.
 * @param {string|null} segmento
 * @param {object} contagens  { clientes, temHorario, profissionais, servicos, produtosFisicos, agendamentos, vendas, whatsappConectado, pagamentoConfigurado, agendamentosPeloLink }
 */
function montarPassos(segmento, contagens) {
  const ordem = ORDEM_POR_SEGMENTO[String(segmento || '').toUpperCase()] || ORDEM_POR_SEGMENTO.HIBRIDO;
  const passos = ordem.map((chave) => ({
    chave,
    titulo: PASSOS[chave].titulo,
    rota: PASSOS[chave].rota,
    concluido: Boolean(PASSOS[chave].concluido(contagens)),
  }));
  const feitos = passos.filter((p) => p.concluido).length;
  return {
    passos,
    feitos,
    total: passos.length,
    proximo: passos.find((p) => !p.concluido)?.chave || null,
    completo: feitos === passos.length,
  };
}

/** Le as contagens do banco e devolve o checklist do tenant. */
async function carregarPassos(clienteId) {
  const [cliente, profissionais, servicos, produtosFisicos, agendamentos, agendamentosPeloLink, vendas, bot, pagamento, clientes] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { segmento: true, horarioFuncionamento: true } }),
    prisma.especialista.count({ where: { clienteId, ativo: true } }),
    prisma.produto.count({ where: { clienteId, tipo: 'SERVICO' } }),
    prisma.produto.count({ where: { clienteId, tipo: 'FISICO' } }),
    prisma.agendamento.count({ where: { clienteId } }),
    prisma.agendamento.count({ where: { clienteId, origem: 'LINK_PUBLICO' } }),
    prisma.venda.count({ where: { clienteId } }),
    prisma.bot.findFirst({ where: { clienteId, identificadorCanal: { not: null } }, select: { id: true } }),
    prisma.configuracaoPagamento.findUnique({ where: { clienteId }, select: { ativo: true } }),
    prisma.lead.count({ where: { clienteId } }),
  ]);

  return montarPassos(cliente?.segmento, {
    temHorario: Boolean(cliente?.horarioFuncionamento),
    profissionais,
    servicos,
    produtosFisicos,
    agendamentos,
    agendamentosPeloLink,
    vendas,
    whatsappConectado: Boolean(bot),
    pagamentoConfigurado: Boolean(pagamento?.ativo),
    clientes,
  });
}

module.exports = { montarPassos, carregarPassos, PASSOS, ORDEM_POR_SEGMENTO };

// =====================================================================
// SINAL POR PIX — parte do valor paga na hora de agendar.
// =====================================================================
//   - Percentual: Produto.sinalPercentual (null = padrao do negocio;
//     0 = esse servico nao cobra) > Cliente.sinalPadraoPct.
//   - So cobra se o negocio tem recebimento configurado (ConfiguracaoPagamento
//     ativa). Sem isso o agendamento segue normal e a tela explica.
//   - Cobranca origem AGENDAMENTO (refId = agendamentoId) pelo pagamentoService.
//   - Prazo: 4 h (padrao), nunca depois do horario. Muito em cima da hora
//     (menos de 30 min) nao cobra.
//   - Pago (pagamentoHooks/agendamento.js): sinalStatus PAGO, confirma o
//     horario, lanca a receita e avisa.
//   - Venceu sem pagar (tarefa): libera o horario (CANCELED), avisa a cliente,
//     e a vaga vai pra fila de encaixe.
//   - Ao concluir, o sinal pago abate do valor cobrado no balcao.
// sinalStatus: PENDENTE | PAGO | EXPIRADO | CANCELADO | DEVOLVIDO
// =====================================================================

const prisma = require('../prisma');
const { criarNotificacao } = require('../utils/notificacoes');
const { round2, brl, diaHoraTexto, horaTexto, primeiroNome } = require('./utilAgenda');

const PRAZO_PADRAO_HORAS = 4;
const ANTECEDENCIA_MINIMA_MIN = 30;
const VALOR_MINIMO = 1;

// ---------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------

/** Percentual efetivo: o do servico vence o do negocio (0 no servico = nao cobra). */
function percentualSinal({ pctServico = null, pctNegocio = null }) {
  const valido = (v) => Number.isFinite(Number(v)) && v !== null && v !== '';
  const pct = valido(pctServico) ? Number(pctServico) : (valido(pctNegocio) ? Number(pctNegocio) : 0);
  return Math.min(100, Math.max(0, Math.round(pct)));
}

function valorSinal({ preco, pct }) {
  const v = round2((Number(preco) || 0) * (Number(pct) || 0) / 100);
  return v >= VALOR_MINIMO ? v : 0;
}

/**
 * Ate quando a cliente pode pagar: agora + 4 h, nunca depois do horario.
 * Retorna null quando o horario esta perto demais pra cobrar sinal.
 */
function prazoDoSinal({ agora = new Date(), dataAgendamento, horas = PRAZO_PADRAO_HORAS }) {
  const inicio = new Date(dataAgendamento).getTime();
  if (!Number.isFinite(inicio) || inicio - agora.getTime() < ANTECEDENCIA_MINIMA_MIN * 60000) return null;
  return new Date(Math.min(agora.getTime() + horas * 3600000, inicio));
}

/** Quanto falta pagar no balcao depois do sinal pago. */
function valorAposSinal({ preco, sinalValor, sinalStatus }) {
  const total = Number(preco) || 0;
  if (sinalStatus !== 'PAGO') return round2(total);
  return round2(Math.max(0, total - (Number(sinalValor) || 0)));
}

// ---------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------

async function pagamentoConfigurado(clienteId) {
  const c = await prisma.configuracaoPagamento.findUnique({ where: { clienteId }, select: { ativo: true } });
  return !!c?.ativo;
}

/** Percentual que vale pra este servico neste negocio. */
async function percentualDoServico(clienteId, produtoId) {
  const [cliente, produto] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { sinalPadraoPct: true } }),
    produtoId ? prisma.produto.findFirst({ where: { id: produtoId, clienteId }, select: { sinalPercentual: true } }) : null,
  ]);
  return percentualSinal({ pctServico: produto?.sinalPercentual ?? null, pctNegocio: cliente?.sinalPadraoPct ?? null });
}

async function enviarWhats(msg) {
  try {
    const { enviarMensagemTenant } = require('../services/mensagemTenant');
    return await enviarMensagemTenant(msg);
  } catch (e) {
    console.error('[sinal] whatsapp', e?.message);
    return { ok: false };
  }
}

/**
 * Cobra o sinal de um agendamento recem-criado. Nunca lanca: se algo falha o
 * agendamento continua valendo, sem sinal, e o motivo volta pra tela.
 * @returns {Promise<{ cobrado: boolean, motivo?: string, sinal?: object }>}
 */
async function cobrarSinal({ agendamento, produtoId = null, pct = null, agora = new Date(), enviarWhatsapp = true }) {
  try {
    const clienteId = agendamento.clienteId;
    if (!(await pagamentoConfigurado(clienteId))) return { cobrado: false, motivo: 'SEM_PAGAMENTO' };
    const percentual = pct != null ? percentualSinal({ pctServico: pct }) : await percentualDoServico(clienteId, produtoId);
    const valor = valorSinal({ preco: agendamento.preco, pct: percentual });
    if (!valor) return { cobrado: false, motivo: 'SEM_SINAL' };
    const expiraEm = prazoDoSinal({ agora, dataAgendamento: agendamento.data });
    if (!expiraEm) return { cobrado: false, motivo: 'MUITO_PERTO' };

    const { criarCobranca } = require('../services/pagamentoService');
    const cobranca = await criarCobranca({
      clienteId, origem: 'AGENDAMENTO', refId: agendamento.id, valor, metodo: 'PIX',
      descricao: `Sinal: ${agendamento.servico || 'agendamento'} em ${diaHoraTexto(agendamento.data)}`,
      vencimento: expiraEm.toISOString(),
    });

    // Token do link publico (pra cliente acompanhar o pagamento pela pagina).
    let token = agendamento.tokenConfirmacao;
    if (!token) token = require('crypto').randomBytes(18).toString('base64url');
    await prisma.agendamento.update({
      where: { id: agendamento.id },
      data: { sinalValor: valor, sinalStatus: 'PENDENTE', sinalCobrancaId: cobranca.id, sinalExpiraEm: expiraEm, tokenConfirmacao: token },
    });
    await prisma.historicoAgendamento.create({
      data: { agendamentoId: agendamento.id, acao: 'EDITADO', alteracoes: { sinal: { de: null, para: `${brl(valor)} por Pix, até ${diaHoraTexto(expiraEm)}` } }, origem: 'SINAL' },
    }).catch(() => {});

    if (enviarWhatsapp && agendamento.telefoneCliente && cobranca.qrCode) {
      const texto = `Oi, ${primeiroNome(agendamento.nomeCliente)}! Seu horário está reservado: ${agendamento.servico || 'atendimento'}, ${diaHoraTexto(agendamento.data)}.\n`
        + `Pra garantir, pague o sinal de ${brl(valor)} por Pix. O resto você paga no atendimento. Se não pagar até ${horaTexto(expiraEm)}, o horário volta pra agenda.\n\n`
        + `Pix copia e cola:\n${cobranca.qrCode}`
        + (cobranca.linkUrl ? `\n\nOu pague por aqui: ${cobranca.linkUrl}` : '');
      await enviarWhats({ clienteId, para: agendamento.telefoneCliente, texto, tipo: 'conversa' });
    }

    return {
      cobrado: true,
      sinal: {
        valor, status: 'PENDENTE', expiraEm, cobrancaId: cobranca.id, token,
        qrCode: cobranca.qrCode || null, qrCodeBase64: cobranca.qrCodeBase64 || null, linkUrl: cobranca.linkUrl || null,
      },
    };
  } catch (e) {
    console.error('[sinal] cobrar', e?.message);
    return { cobrado: false, motivo: 'FALHA_COBRANCA' };
  }
}

/** Sinal pago (gancho da cobranca). Idempotente. */
async function sinalPago(cobranca) {
  const ag = await prisma.agendamento.findFirst({ where: { id: cobranca.refId, clienteId: cobranca.clienteId } });
  if (!ag) return;
  if (ag.sinalStatus === 'PAGO') return;

  const confirmar = ag.status === 'PENDING';
  const mudou = await prisma.agendamento.updateMany({
    where: { id: ag.id, sinalStatus: { not: 'PAGO' } },
    data: {
      sinalStatus: 'PAGO', sinalValor: ag.sinalValor ?? cobranca.valor,
      ...(confirmar ? { status: 'CONFIRMED', confirmadoEm: new Date(), confirmadoPor: 'SINAL_PIX' } : {}),
    },
  });
  if (mudou.count === 0) return;

  // Dinheiro entrou: receita paga (sem caixa fisico — veio por Pix).
  await prisma.lancamentoFinanceiro.create({
    data: {
      clienteId: ag.clienteId, leadId: ag.leadId || null,
      descricao: `Sinal por Pix: ${ag.nomeCliente}${ag.servico ? ` · ${ag.servico}` : ''}`,
      valor: cobranca.valor, tipo: 'RECEITA', status: 'PAGO', metodoPagamento: 'PIX',
      dataVencimento: new Date(), dataPagamento: cobranca.pagoEm || new Date(),
    },
  });
  await prisma.historicoAgendamento.create({
    data: {
      agendamentoId: ag.id, acao: 'STATUS_MUDADO', usuarioNome: 'Cliente', origem: 'SINAL',
      alteracoes: { sinal: { de: ag.sinalStatus, para: 'PAGO' }, ...(confirmar ? { status: { de: 'PENDING', para: 'CONFIRMED' } } : {}) },
    },
  }).catch(() => {});

  if (ag.status === 'CANCELED') {
    // Pagou depois do prazo: o horario ja foi liberado. Avisa o dono pra resolver.
    await criarNotificacao(prisma, {
      clienteId: ag.clienteId, tipo: 'GENERICA', titulo: 'Sinal pago depois do prazo',
      mensagem: `${ag.nomeCliente} pagou o sinal de ${brl(cobranca.valor)}, mas o horário de ${diaHoraTexto(ag.data)} já tinha sido liberado. Combine um novo horário ou devolva o valor.`,
      link: '/app/agenda', dados: { agendamentoId: ag.id },
    }).catch(() => {});
    return;
  }

  await criarNotificacao(prisma, {
    clienteId: ag.clienteId, tipo: 'GENERICA', titulo: 'Sinal pago',
    mensagem: `${ag.nomeCliente} pagou o sinal de ${brl(cobranca.valor)}. Horário de ${diaHoraTexto(ag.data)} confirmado.`,
    link: '/app/agenda', dados: { agendamentoId: ag.id },
  }).catch(() => {});
  if (ag.telefoneCliente) {
    const resto = valorAposSinal({ preco: ag.preco, sinalValor: cobranca.valor, sinalStatus: 'PAGO' });
    await enviarWhats({
      clienteId: ag.clienteId, para: ag.telefoneCliente, tipo: 'conversa',
      texto: `Recebemos ${brl(cobranca.valor)}. Horário garantido: ${diaHoraTexto(ag.data)}.${resto > 0 ? ` No atendimento você paga ${brl(resto)}.` : ''}`,
    });
  }
}

/** Tarefa do worker: sinal vencido libera o horario. */
async function expirarSinais(agora = new Date()) {
  const vencidos = await prisma.agendamento.findMany({
    where: { sinalStatus: 'PENDENTE', sinalExpiraEm: { lte: agora }, status: { in: ['PENDING', 'CONFIRMED'] } },
    take: 200,
  });
  let liberados = 0;
  for (const ag of vencidos) {
    // Confirmado na mao pela equipe = a equipe dispensou o sinal: so encerra
    // a cobranca, sem soltar o horario.
    const liberar = ag.status === 'PENDING';
    const mudou = await prisma.agendamento.updateMany({
      where: { id: ag.id, sinalStatus: 'PENDENTE' },
      data: { sinalStatus: 'EXPIRADO', ...(liberar ? { status: 'CANCELED' } : {}) },
    });
    if (mudou.count === 0) continue; // pagou no meio do caminho
    if (ag.sinalCobrancaId) {
      await prisma.cobranca.updateMany({ where: { id: ag.sinalCobrancaId, status: 'PENDENTE' }, data: { status: 'EXPIRADO' } }).catch(() => {});
    }
    if (!liberar) continue;
    liberados += 1;
    await prisma.historicoAgendamento.create({
      data: {
        agendamentoId: ag.id, acao: 'STATUS_MUDADO', usuarioNome: 'Sistema', origem: 'SINAL',
        alteracoes: { status: { de: ag.status, para: 'CANCELED' }, motivo: 'Sinal não pago no prazo' },
      },
    }).catch(() => {});
    await criarNotificacao(prisma, {
      clienteId: ag.clienteId, tipo: 'GENERICA', titulo: 'Sinal não pago: horário liberado',
      mensagem: `${ag.nomeCliente} não pagou o sinal até ${horaTexto(ag.sinalExpiraEm)}. O horário de ${diaHoraTexto(ag.data)} voltou pra agenda.`,
      link: '/app/agenda', dados: { agendamentoId: ag.id },
    }).catch(() => {});
    if (ag.telefoneCliente) {
      await enviarWhats({
        clienteId: ag.clienteId, para: ag.telefoneCliente, tipo: 'conversa',
        texto: `Oi, ${primeiroNome(ag.nomeCliente)}! O sinal do horário de ${diaHoraTexto(ag.data)} não foi pago a tempo, então o horário voltou pra agenda. Se ainda quiser, é só marcar de novo.`,
      });
    }
    await require('./encaixe').registrarVaga(ag, { agora });
  }
  return { liberados };
}

/** Cancelou antes de pagar: a cobranca pendente nao vale mais. */
async function cancelarSinalPendente(agendamento) {
  if (agendamento?.sinalStatus !== 'PENDENTE') return;
  await prisma.agendamento.updateMany({ where: { id: agendamento.id, sinalStatus: 'PENDENTE' }, data: { sinalStatus: 'CANCELADO' } });
  if (agendamento.sinalCobrancaId) {
    await prisma.cobranca.updateMany({ where: { id: agendamento.sinalCobrancaId, status: 'PENDENTE' }, data: { status: 'CANCELADO' } }).catch(() => {});
  }
}

module.exports = {
  percentualSinal, valorSinal, prazoDoSinal, valorAposSinal,
  pagamentoConfigurado, percentualDoServico, cobrarSinal, sinalPago, expirarSinais, cancelarSinalPendente,
  PRAZO_PADRAO_HORAS,
};

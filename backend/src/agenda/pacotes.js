// =====================================================================
// PACOTES DE SESSOES — vende N sessoes de um servico, consome 1 por
// atendimento concluido.
// =====================================================================
//   PacoteModelo   o que se vende (servico, sessoes, preco, validade).
//   PacoteCliente  o que a cliente comprou (saldo, parcelas, validade).
//   PacoteUso      1 linha por atendimento (agendamentoId @unique = idempotente).
//
// Consumo: no "Concluir" do agendamento com pacoteClienteId (mesma transacao
// da venda). Estorno: agendamento concluido que volta a cancelado, ou venda do
// atendimento cancelada (reconciliacao no worker e ao abrir as telas).
// PacoteCliente.status: ATIVO | ACABOU | VENCIDO | CANCELADO
// =====================================================================

const prisma = require('../prisma');
const { criarNotificacao } = require('../utils/notificacoes');
const { round2, brl, servicoBase, mesmoTelefone, partesBRT } = require('./utilAgenda');

const DIA_MS = 86400000;
const ACABANDO_SESSOES = 2;
const ACABANDO_DIAS = 30;

// ---------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------

function saldoPacote(p) {
  return Math.max(0, (p.sessoesTotal || 0) - (p.sessoesUsadas || 0));
}

function validoAteDe(inicio, validadeDias) {
  // Vale ate o fim do dia (Brasilia) do ultimo dia de validade.
  const fim = new Date(new Date(inicio).getTime() + Math.max(1, validadeDias) * DIA_MS);
  return new Date(`${partesBRT(fim).ymd}T23:59:59.000-03:00`);
}

function situacaoPacote(p, agora = new Date()) {
  if (p.status === 'CANCELADO') return 'CANCELADO';
  if (saldoPacote(p) === 0) return 'ACABOU';
  if (new Date(p.validoAte).getTime() < agora.getTime()) return 'VENCIDO';
  return 'ATIVO';
}

/** Ativo e com 2 sessoes ou menos, ou vencendo em ate 30 dias. */
function estaAcabando(p, agora = new Date()) {
  if (situacaoPacote(p, agora) !== 'ATIVO') return false;
  if (saldoPacote(p) <= ACABANDO_SESSOES) return true;
  return new Date(p.validoAte).getTime() - agora.getTime() <= ACABANDO_DIAS * DIA_MS;
}

function valorPorSessao(p) {
  return p.sessoesTotal > 0 ? round2(p.valor / p.sessoesTotal) : 0;
}

/** Valor da parcela i (1..n); o centavo que sobra vai na ultima. */
function valorParcela(valor, parcelas, i) {
  const n = Math.max(1, parcelas);
  const base = Math.floor((valor / n) * 100) / 100;
  return i === n ? round2(valor - base * (n - 1)) : base;
}

/**
 * Da pra usar este pacote neste agendamento?
 * @param {{ pacote, servico?: string, servicoPacote?: string, dataAgendamento, reservados?: number, ultimoUso?: Date|null, intervaloMinDias?: number|null, agora?: Date }} p
 */
function podeUsarPacote({ pacote, servico = null, servicoPacote = null, dataAgendamento, reservados = 0, ultimoUso = null, intervaloMinDias = null, agora = new Date() }) {
  if (!pacote) return { ok: false, motivo: 'Pacote não encontrado.' };
  const sit = situacaoPacote(pacote, agora);
  if (sit === 'CANCELADO') return { ok: false, motivo: 'Esse pacote foi cancelado.' };
  if (sit === 'ACABOU') return { ok: false, motivo: 'As sessões desse pacote acabaram.' };
  if (new Date(dataAgendamento).getTime() > new Date(pacote.validoAte).getTime()) return { ok: false, motivo: 'O pacote vence antes desse horário.' };
  if (sit === 'VENCIDO') return { ok: false, motivo: 'Esse pacote venceu.' };
  if (saldoPacote(pacote) - reservados <= 0) return { ok: false, motivo: 'Todas as sessões restantes já estão marcadas na agenda.' };
  if (servico && servicoPacote && servicoBase(servico) !== servicoBase(servicoPacote)) return { ok: false, motivo: 'Esse pacote é de outro serviço.' };
  if (intervaloMinDias && ultimoUso) {
    const minimo = new Date(ultimoUso).getTime() + intervaloMinDias * DIA_MS;
    if (new Date(dataAgendamento).getTime() < minimo) return { ok: false, motivo: `Esse pacote pede ${intervaloMinDias} dias entre as sessões.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------

const INCLUDE_MODELO = { modelo: { select: { id: true, nome: true, produtoId: true, servico: true, intervaloMinDias: true } } };

/** Sessoes ja marcadas (futuras, nao canceladas, nao concluidas) por pacote. */
async function reservadosPorPacote(ids, { ignorarAgendamentoId = null } = {}) {
  if (!ids.length) return new Map();
  const ags = await prisma.agendamento.findMany({
    where: { pacoteClienteId: { in: ids }, status: { in: ['PENDING', 'CONFIRMED'] }, ...(ignorarAgendamentoId ? { NOT: { id: ignorarAgendamentoId } } : {}) },
    select: { pacoteClienteId: true },
  });
  const m = new Map();
  for (const a of ags) m.set(a.pacoteClienteId, (m.get(a.pacoteClienteId) || 0) + 1);
  return m;
}

async function ultimoUsoDe(pacoteClienteId) {
  const u = await prisma.pacoteUso.findFirst({ where: { pacoteClienteId, estornadoEm: null }, orderBy: { usadoEm: 'desc' }, select: { usadoEm: true } });
  return u?.usadoEm || null;
}

/** Leads do negocio com esse telefone (comparando os 8 ultimos digitos). */
async function leadsPorTelefone(clienteId, telefone) {
  if (!telefone) return [];
  const leads = await prisma.lead.findMany({ where: { clienteId, telefone: { not: null } }, select: { id: true, telefone: true } });
  return leads.filter((l) => mesmoTelefone(l.telefone, telefone)).map((l) => l.id);
}

/**
 * Pacotes ativos de uma cliente (por lead ou telefone), com saldo livre.
 * @returns {Promise<Array<{ id, nome, servico, produtoId, sessoesTotal, sessoesUsadas, saldo, reservados, livres, validoAte }>>}
 */
async function pacotesAtivosDaCliente({ clienteId, leadId = null, telefone = null, agora = new Date() }) {
  const leadIds = new Set(leadId ? [leadId] : []);
  for (const id of await leadsPorTelefone(clienteId, telefone)) leadIds.add(id);
  if (leadIds.size === 0) return [];
  const pacotes = await prisma.pacoteCliente.findMany({
    where: { clienteId, leadId: { in: [...leadIds] }, status: 'ATIVO', validoAte: { gte: agora } },
    include: INCLUDE_MODELO, orderBy: { validoAte: 'asc' },
  });
  const reservados = await reservadosPorPacote(pacotes.map((p) => p.id));
  return pacotes
    .filter((p) => saldoPacote(p) > 0)
    .map((p) => {
      const r = reservados.get(p.id) || 0;
      return {
        id: p.id, nome: p.modelo.nome, servico: p.modelo.servico, produtoId: p.modelo.produtoId,
        sessoesTotal: p.sessoesTotal, sessoesUsadas: p.sessoesUsadas, saldo: saldoPacote(p),
        reservados: r, livres: Math.max(0, saldoPacote(p) - r), validoAte: p.validoAte,
        intervaloMinDias: p.modelo.intervaloMinDias,
      };
    });
}

/**
 * Valida o pacote escolhido pra um agendamento. Lanca { status: 422 } com a
 * mensagem pra tela.
 */
async function validarUsoNoAgendamento({ clienteId, pacoteClienteId, leadId, telefone, servico, dataAgendamento, ignorarAgendamentoId = null }) {
  const pacote = await prisma.pacoteCliente.findFirst({ where: { id: pacoteClienteId, clienteId }, include: INCLUDE_MODELO });
  const falha = (m) => Object.assign(new Error(m), { status: 422, campos: ['pacoteClienteId'] });
  if (!pacote) throw falha('Pacote não encontrado.');
  const daCliente = (leadId && pacote.leadId === leadId) || (await leadsPorTelefone(clienteId, telefone)).includes(pacote.leadId);
  if (!daCliente) throw falha('Esse pacote é de outra cliente.');
  const reservados = (await reservadosPorPacote([pacote.id], { ignorarAgendamentoId })).get(pacote.id) || 0;
  const r = podeUsarPacote({
    pacote, servico, servicoPacote: pacote.modelo.servico, dataAgendamento, reservados,
    ultimoUso: await ultimoUsoDe(pacote.id), intervaloMinDias: pacote.modelo.intervaloMinDias,
  });
  if (!r.ok) throw falha(r.motivo);
  return pacote;
}

/**
 * Consome 1 sessao (dentro da transacao do "Concluir"). Idempotente pelo
 * agendamentoId (@unique em PacoteUso).
 * @returns {Promise<null | { pacote, valorSessao: number }>}
 */
async function consumirSessao(tx, agendamento) {
  if (!agendamento.pacoteClienteId) return null;
  const pacote = await tx.pacoteCliente.findFirst({ where: { id: agendamento.pacoteClienteId, clienteId: agendamento.clienteId } });
  if (!pacote) return null;
  const uso = await tx.pacoteUso.findUnique({ where: { agendamentoId: agendamento.id } });
  if (uso && !uso.estornadoEm) return { pacote, valorSessao: valorPorSessao(pacote) };
  if (uso) await tx.pacoteUso.update({ where: { id: uso.id }, data: { estornadoEm: null, usadoEm: new Date() } });
  else await tx.pacoteUso.create({ data: { pacoteClienteId: pacote.id, agendamentoId: agendamento.id } });
  const usadas = pacote.sessoesUsadas + 1;
  const atualizado = await tx.pacoteCliente.update({
    where: { id: pacote.id },
    data: { sessoesUsadas: { increment: 1 }, ...(usadas >= pacote.sessoesTotal ? { status: 'ACABOU' } : {}) },
  });
  return { pacote: atualizado, valorSessao: valorPorSessao(pacote) };
}

/** Devolve a sessao de um atendimento desfeito. Idempotente. */
async function estornarSessao(client, agendamentoId) {
  const uso = await client.pacoteUso.findUnique({ where: { agendamentoId } });
  if (!uso || uso.estornadoEm) return false;
  const mudou = await client.pacoteUso.updateMany({ where: { id: uso.id, estornadoEm: null }, data: { estornadoEm: new Date() } });
  if (mudou.count === 0) return false;
  const p = await client.pacoteCliente.update({ where: { id: uso.pacoteClienteId }, data: { sessoesUsadas: { decrement: 1 } } });
  if (p.status === 'ACABOU' && saldoPacote(p) > 0) {
    await client.pacoteCliente.update({ where: { id: p.id }, data: { status: new Date(p.validoAte) < new Date() ? 'VENCIDO' : 'ATIVO' } });
  }
  return true;
}

/** Tarefa do worker: pacote que passou da validade vira VENCIDO. */
async function vencerPacotes(agora = new Date()) {
  const vencidos = await prisma.pacoteCliente.findMany({
    where: { status: 'ATIVO', validoAte: { lt: agora } }, include: INCLUDE_MODELO, take: 500,
  });
  for (const p of vencidos) {
    const mudou = await prisma.pacoteCliente.updateMany({ where: { id: p.id, status: 'ATIVO' }, data: { status: 'VENCIDO' } });
    if (!mudou.count) continue;
    const lead = await prisma.lead.findUnique({ where: { id: p.leadId }, select: { nome: true } });
    await criarNotificacao(prisma, {
      clienteId: p.clienteId, tipo: 'GENERICA', titulo: 'Pacote venceu',
      mensagem: `O pacote ${p.modelo.nome} de ${lead?.nome || 'uma cliente'} venceu com ${saldoPacote(p)} sessão(ões) sem usar.`,
      link: '/app/pacotes', dados: { pacoteClienteId: p.id },
    }).catch(() => {});
  }
  return { vencidos: vencidos.length };
}

async function enviarWhats(msg) {
  try {
    const { enviarMensagemTenant } = require('../services/mensagemTenant');
    return await enviarMensagemTenant(msg);
  } catch (e) {
    console.error('[pacotes] whatsapp', e?.message);
    return { ok: false };
  }
}

/** Cria a cobranca Pix da parcela `numero` e manda pelo WhatsApp. */
async function cobrarParcela({ pacote, nomeModelo, lead, numero, vencimento = null, cpfCnpj = null }) {
  const { criarCobranca } = require('../services/pagamentoService');
  const valor = valorParcela(pacote.valor, pacote.parcelas, numero);
  const venc = vencimento || new Date(Date.now() + 3 * DIA_MS);
  const cobranca = await criarCobranca({
    clienteId: pacote.clienteId, origem: 'PACOTE', refId: pacote.id, valor, metodo: 'PIX',
    descricao: `Pacote ${nomeModelo}${pacote.parcelas > 1 ? ` (parcela ${numero}/${pacote.parcelas})` : ''}`,
    vencimento: venc.toISOString(),
    // Asaas pede CPF/CNPJ: o do lead do pacote ou o digitado na venda (que
    // fica gravado no lead, pras proximas parcelas sairem sozinhas).
    leadId: pacote.leadId || null,
    pagador: { nome: lead?.nome || undefined, telefone: lead?.telefone || undefined, cpfCnpj: cpfCnpj || undefined },
  });
  if (lead?.telefone && cobranca.qrCode) {
    await enviarWhats({
      clienteId: pacote.clienteId, para: lead.telefone, tipo: 'conversa',
      texto: `Oi, ${String(lead.nome || '').split(' ')[0]}! Segue o Pix do pacote ${nomeModelo}${pacote.parcelas > 1 ? `, parcela ${numero} de ${pacote.parcelas}` : ''}: ${brl(valor)}.\n\nPix copia e cola:\n${cobranca.qrCode}`,
    });
  }
  return cobranca;
}

/** Gancho: parcela paga. Recalcula pelas cobrancas pagas (idempotente) e gera a proxima. */
async function parcelaPaga(cobranca) {
  const pacote = await prisma.pacoteCliente.findFirst({ where: { id: cobranca.refId, clienteId: cobranca.clienteId }, include: INCLUDE_MODELO });
  if (!pacote) return;
  const pagas = await prisma.cobranca.count({ where: { clienteId: pacote.clienteId, origem: 'PACOTE', refId: pacote.id, status: 'PAGO' } });
  const parcelasPagas = Math.min(pacote.parcelas, pagas);
  await prisma.pacoteCliente.update({ where: { id: pacote.id }, data: { parcelasPagas } });

  const lead = await prisma.lead.findUnique({ where: { id: pacote.leadId }, select: { nome: true, telefone: true } });
  const descricao = `Pacote ${pacote.modelo.nome}: ${lead?.nome || 'cliente'} (parcela ${parcelasPagas}/${pacote.parcelas}) · Pix ${cobranca.id.slice(0, 8)}`;
  const ja = await prisma.lancamentoFinanceiro.findFirst({ where: { clienteId: pacote.clienteId, descricao }, select: { id: true } });
  if (!ja) {
    await prisma.lancamentoFinanceiro.create({
      data: {
        clienteId: pacote.clienteId, leadId: pacote.leadId, descricao, valor: cobranca.valor,
        tipo: 'RECEITA', status: 'PAGO', metodoPagamento: 'PIX', dataVencimento: new Date(), dataPagamento: cobranca.pagoEm || new Date(),
      },
    });
  }

  await criarNotificacao(prisma, {
    clienteId: pacote.clienteId, tipo: 'GENERICA', titulo: 'Parcela de pacote paga',
    mensagem: `${lead?.nome || 'Cliente'} pagou ${brl(cobranca.valor)} do pacote ${pacote.modelo.nome} (${parcelasPagas} de ${pacote.parcelas}).`,
    link: '/app/pacotes', dados: { pacoteClienteId: pacote.id },
  }).catch(() => {});

  if (parcelasPagas < pacote.parcelas && pacote.status !== 'CANCELADO') {
    const pendente = await prisma.cobranca.findFirst({ where: { clienteId: pacote.clienteId, origem: 'PACOTE', refId: pacote.id, status: 'PENDENTE' }, select: { id: true } });
    if (!pendente) {
      await cobrarParcela({ pacote, nomeModelo: pacote.modelo.nome, lead, numero: parcelasPagas + 1, vencimento: new Date(Date.now() + 30 * DIA_MS) })
        .catch((e) => console.error('[pacotes] proxima parcela', e?.message));
    }
  }
}

module.exports = {
  // puras
  saldoPacote, validoAteDe, situacaoPacote, estaAcabando, valorPorSessao, valorParcela, podeUsarPacote,
  // banco
  INCLUDE_MODELO, reservadosPorPacote, pacotesAtivosDaCliente, validarUsoNoAgendamento,
  consumirSessao, estornarSessao, vencerPacotes, cobrarParcela, parcelaPaga,
};

// =====================================================================
// RESPOSTA DO CLIENTE AO LEMBRETE — confirmar ou pedir pra remarcar.
// =====================================================================
// Tres portas, uma regra so (aplicarResposta):
//   1. botao do template oficial  -> payload "CONFIRMAR:<token>" / "REMARCAR:<token>"
//   2. texto no WhatsApp ("1", "sim", "2", "remarcar") -> acha o agendamento
//      que recebeu lembrete pra aquele telefone nas proximas 48 h
//   3. link publico /confirmar/<token> (routes/publico.routes.js)
//
// REMARCAR cancela o horario (libera a vaga) e avisa a equipe pra combinar
// outro — com o link de agendamento quando o plano tiver. A vaga vai pra fila
// de encaixe (agenda/encaixe.js).
// So respostas CURTAS e exatas contam (texto livre segue pro bot normal),
// pra uma conversa comum nunca virar confirmacao sem querer.
// =====================================================================

const prisma = require('../prisma');
const { criarNotificacao } = require('../utils/notificacoes');

const JANELA_RESPOSTA_MS = 48 * 60 * 60 * 1000;
const RESPOSTAS_CONFIRMAR = new Set(['1', 'sim', 's', 'confirmo', 'confirmar', 'confirmado', 'confirmada', 'ok', 'confirma']);
const RESPOSTAS_REMARCAR = new Set(['2', 'remarcar', 'remarca', 'nao', 'não', 'n', 'cancelar', 'desmarcar']);

/** Regra pura: o que o cliente respondeu? */
function interpretarResposta({ texto = '', payload = '' } = {}) {
  const p = String(payload || '');
  const m = /^(CONFIRMAR|REMARCAR):([A-Za-z0-9_-]{10,64})$/.exec(p);
  if (m) return { acao: m[1], token: m[2] };

  const t = String(texto || '').trim().toLowerCase().replace(/[.!*]+$/g, '');
  if (RESPOSTAS_CONFIRMAR.has(t)) return { acao: 'CONFIRMAR', token: null };
  if (RESPOSTAS_REMARCAR.has(t)) return { acao: 'REMARCAR', token: null };
  return null;
}

function ultimosDigitos(telefone, n = 8) {
  return String(telefone || '').replace(/\D/g, '').slice(-n);
}

/**
 * Aplica CONFIRMAR/REMARCAR num agendamento. Idempotente: confirmar o que ja
 * esta confirmado so devolve ok.
 * @param {{ agendamento: object, acao: 'CONFIRMAR'|'REMARCAR', origem: 'CLIENTE_WHATSAPP'|'CLIENTE_LINK' }} p
 * @returns {Promise<{ ok: boolean, status: string, mensagem: string }>}
 */
async function aplicarResposta({ agendamento, acao, origem }) {
  if (!agendamento) return { ok: false, status: null, mensagem: 'Agendamento não encontrado.' };
  if (agendamento.status === 'CANCELED') return { ok: false, status: 'CANCELED', mensagem: 'Este horário já foi cancelado.' };
  if (agendamento.status === 'COMPLETED') return { ok: false, status: 'COMPLETED', mensagem: 'Este atendimento já foi concluído.' };
  if (new Date(agendamento.data).getTime() < Date.now()) return { ok: false, status: agendamento.status, mensagem: 'Este horário já passou.' };

  if (acao === 'CONFIRMAR') {
    if (agendamento.status !== 'CONFIRMED') {
      await prisma.agendamento.update({
        where: { id: agendamento.id },
        data: { status: 'CONFIRMED', confirmadoEm: new Date(), confirmadoPor: origem },
      });
      await prisma.historicoAgendamento.create({
        data: { agendamentoId: agendamento.id, acao: 'STATUS_MUDADO', alteracoes: { status: { de: agendamento.status, para: 'CONFIRMED' } }, usuarioNome: 'Cliente', origem },
      }).catch(() => {});
    }
    return { ok: true, status: 'CONFIRMED', mensagem: 'Presença confirmada. Até lá!' };
  }

  // REMARCAR
  const antes = await prisma.agendamento.findUnique({ where: { id: agendamento.id } });
  await prisma.agendamento.update({ where: { id: agendamento.id }, data: { status: 'CANCELED' } });
  // Fase 2: o horario vagou -> fila de encaixe (e sinal pendente cancelado).
  await require('./eventosAgenda').aoLiberarHorario(antes, { cancelado: true });
  await prisma.historicoAgendamento.create({
    data: { agendamentoId: agendamento.id, acao: 'STATUS_MUDADO', alteracoes: { status: { de: agendamento.status, para: 'CANCELED' }, motivo: 'Cliente pediu para remarcar' }, usuarioNome: 'Cliente', origem },
  }).catch(() => {});
  await criarNotificacao(prisma, {
    clienteId: agendamento.clienteId,
    tipo: 'GENERICA',
    titulo: 'Cliente pediu para remarcar',
    mensagem: `${agendamento.nomeCliente} pediu para remarcar o horário. A vaga foi liberada — combine um novo horário.`,
    link: '/app/agenda',
    dados: { agendamentoId: agendamento.id, telefone: agendamento.telefoneCliente || null },
  }).catch((e) => console.error('[respostaLembrete] notificacao', e?.message));

  const cliente = await prisma.cliente.findUnique({ where: { id: agendamento.clienteId }, select: { slugPublico: true } });
  const base = (process.env.APP_URL_PUBLICA || '').replace(/\/$/, '');
  const link = cliente?.slugPublico && base ? ` Se preferir, escolha um novo horário aqui: ${base}/agendar/${cliente.slugPublico}` : '';
  return { ok: true, status: 'CANCELED', mensagem: `Tudo bem, liberamos esse horário e a equipe vai falar com você para remarcar.${link}` };
}

/**
 * Porta do WhatsApp: chamada no inicio de processarMensagemRecebida.
 * @returns {Promise<{ tratado: false } | { tratado: true, resposta: string }>}
 */
async function tratarRespostaWhatsapp({ clienteId, de, texto, payload }) {
  const interpretacao = interpretarResposta({ texto, payload });
  if (!interpretacao) return { tratado: false };

  let agendamento = null;
  if (interpretacao.token) {
    agendamento = await prisma.agendamento.findFirst({ where: { clienteId, tokenConfirmacao: interpretacao.token } });
  } else {
    // Resposta por texto: so vale se ESTE telefone recebeu lembrete e tem
    // horario chegando. Sem isso, "sim" e so conversa — segue pro bot.
    const sufixo = ultimosDigitos(de);
    if (sufixo.length < 8) return { tratado: false };
    const agora = new Date();
    const candidatos = await prisma.agendamento.findMany({
      where: {
        clienteId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        data: { gt: agora, lte: new Date(agora.getTime() + JANELA_RESPOSTA_MS) },
        telefoneCliente: { not: null },
        OR: [{ lembrete24hEm: { not: null } }, { lembrete2hEm: { not: null } }],
      },
      orderBy: { data: 'asc' },
      take: 200,
    });
    // O telefone e gravado como foi digitado (com ou sem mascara): compara
    // so os digitos finais.
    agendamento = candidatos.find((a) => ultimosDigitos(a.telefoneCliente) === sufixo) || null;
  }
  if (!agendamento) return { tratado: false };

  const r = await aplicarResposta({ agendamento, acao: interpretacao.acao, origem: 'CLIENTE_WHATSAPP' });
  return { tratado: true, resposta: r.mensagem };
}

module.exports = { interpretarResposta, aplicarResposta, tratarRespostaWhatsapp, RESPOSTAS_CONFIRMAR, RESPOSTAS_REMARCAR };

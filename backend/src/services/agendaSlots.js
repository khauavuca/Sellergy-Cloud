// =====================================================================
// SERVICO COMPARTILHADO — HORARIOS LIVRES DA AGENDA
// =====================================================================
// Calcula os horarios livres de um especialista num dia, reaproveitando a
// MESMA regra de conflito da agenda (sobreposicao de intervalo, ignora
// CANCELED, conflito so no mesmo especialista). Read-only: nao escreve nada.
//
// Usado por:
//   - o bot de WhatsApp (agendamento por menu, sem IA) — Frente 4;
//   - pode servir a UI da Agenda (sugestao de horarios) no futuro.
//
// IMPORTANTE — numeracao de dia da semana (duas convencoes no projeto):
//   - Especialista.jornada usa 1=segunda .. 7=domingo (ISO-8601).
//   - Cliente.horarioFuncionamento.dias usa 0=domingo .. 6=sabado (Date.getDay()).
//   Este modulo converte entre as duas. Errar isso desloca a agenda em 1 dia.
// =====================================================================

const prisma = require('../prisma');

const DURACAO_PADRAO_MIN = 30;
// Granularidade de inicio dos slots (de 30 em 30 min por padrao). Slots
// comecam alinhados ao passo dentro de cada janela da jornada.
const PASSO_PADRAO_MIN = 30;

// "HH:MM" -> minutos desde a meia-noite. Retorna null se invalido.
function horaParaMinutos(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// Date.getDay() (0=dom..6=sab) -> dia ISO (1=seg..7=dom), chave da jornada.
function diaIso(data) {
  const d = data.getDay();
  return d === 0 ? 7 : d;
}

// Constroi um Date no mesmo dia de `base`, no minuto-do-dia informado.
function dataNoMinuto(base, minutosDoDia) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutosDoDia);
  return d;
}

// Horario que a tela de Configuracoes mostra antes de o negocio salvar
// (seg a sab, 08:00-18:00). Sem isso, quem nunca clicou em "Salvar" ficava
// sem nenhum horario livre (link de agendamento e atalho do WhatsApp vazios).
const HORARIO_PADRAO = Object.freeze({ abertura: '08:00', fechamento: '18:00', dias: [1, 2, 3, 4, 5, 6] });

// Retorna as janelas de trabalho [{ inicioMin, fimMin }] do especialista no
// dia `data`. Prioridade: jornada propria; senao herda horarioFuncionamento
// do tenant (ou o padrao, se nunca foi salvo). Retorna [] se o dia nao for de expediente.
function janelasDoDia({ jornada, horarioFuncionamento: hfSalvo, data }) {
  const horarioFuncionamento = hfSalvo && typeof hfSalvo === 'object' ? hfSalvo : HORARIO_PADRAO;
  // 1) Jornada propria do especialista (1=seg..7=dom).
  if (jornada && typeof jornada === 'object') {
    const blocos = jornada[String(diaIso(data))];
    if (!Array.isArray(blocos)) return [];
    return blocos
      .map((b) => ({ inicioMin: horaParaMinutos(b?.inicio), fimMin: horaParaMinutos(b?.fim) }))
      .filter((j) => j.inicioMin != null && j.fimMin != null && j.fimMin > j.inicioMin);
  }

  // 2) Fallback: expediente do tenant (dias em 0=dom..6=sab).
  if (horarioFuncionamento && typeof horarioFuncionamento === 'object') {
    const dias = Array.isArray(horarioFuncionamento.dias) ? horarioFuncionamento.dias : [1, 2, 3, 4, 5, 6];
    if (!dias.includes(data.getDay())) return [];
    const inicioMin = horaParaMinutos(horarioFuncionamento.abertura) ?? horaParaMinutos('08:00');
    const fimMin = horaParaMinutos(horarioFuncionamento.fechamento) ?? horaParaMinutos('18:00');
    if (inicioMin == null || fimMin == null || fimMin <= inicioMin) return [];
    return [{ inicioMin, fimMin }];
  }

  return [];
}

// Dois intervalos [aIni,aFim) e [bIni,bFim) se sobrepoem? (mesma regra da
// agenda: dataNova < fim && fimNovo > inicio).
function sobrepoe(aIni, aFim, bIni, bFim) {
  return aIni < bFim && aFim > bIni;
}

/**
 * Lista os horarios livres de um especialista num dia.
 *
 * @param {Object} p
 * @param {string} p.clienteId       tenant (obrigatorio).
 * @param {string} p.especialistaId  especialista que vai atender (obrigatorio).
 * @param {Date|string} p.data       dia a consultar (qualquer hora desse dia).
 * @param {string} [p.variacaoId]    variacao do servico — fonte da duracaoMin.
 * @param {number} [p.duracaoMin]    duracao explicita (sobrepoe a da variacao).
 * @param {number} [p.passoMin]      granularidade de inicio dos slots.
 * @param {Date}   [p.agora]         "agora" (injetavel p/ teste); corta passado.
 * @returns {Promise<Array<{ inicio: string, fim: string, inicioMin: number }>>}
 */
async function listarHorariosLivres({
  clienteId,
  especialistaId,
  data,
  variacaoId = null,
  duracaoMin = null,
  passoMin = PASSO_PADRAO_MIN,
  agora = new Date(),
}) {
  if (!clienteId) throw new Error('clienteId é obrigatório');
  if (!especialistaId) throw new Error('especialistaId é obrigatório');

  const dia = data instanceof Date ? new Date(data) : new Date(data);
  if (Number.isNaN(dia.getTime())) throw new Error('data inválida');

  // Especialista (jornada) — preso ao tenant pra nao vazar entre clientes.
  const especialista = await prisma.especialista.findFirst({
    where: { id: especialistaId, clienteId },
    select: { id: true, ativo: true, jornada: true },
  });
  if (!especialista || !especialista.ativo) return [];

  // Duracao: explicita > da variacao (preso ao tenant) > padrao.
  let duracao = Number.isInteger(duracaoMin) && duracaoMin > 0 ? duracaoMin : null;
  if (!duracao && variacaoId) {
    const variacao = await prisma.variacaoProduto.findFirst({
      where: { id: variacaoId, produto: { clienteId } },
      select: { duracaoMin: true },
    });
    if (variacao?.duracaoMin && variacao.duracaoMin > 0) duracao = variacao.duracaoMin;
  }
  if (!duracao) duracao = DURACAO_PADRAO_MIN;

  // Expediente do tenant (fallback da jornada).
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { horarioFuncionamento: true },
  });

  const janelas = janelasDoDia({
    jornada: especialista.jornada,
    horarioFuncionamento: cliente?.horarioFuncionamento,
    data: dia,
  });
  if (janelas.length === 0) return [];

  // Agendamentos do especialista no dia (exceto CANCELED) — ocupados.
  const inicioDia = new Date(dia);
  inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date(dia);
  fimDia.setHours(23, 59, 59, 999);

  const ocupados = await prisma.agendamento.findMany({
    where: {
      clienteId,
      especialistaId,
      data: { gte: inicioDia, lte: fimDia },
      status: { not: 'CANCELED' },
    },
    select: { data: true, duracao: true },
  });

  const intervalosOcupados = ocupados.map((o) => {
    const ini = new Date(o.data).getTime();
    return { ini, fim: ini + (o.duracao || DURACAO_PADRAO_MIN) * 60000 };
  });

  const passo = Number.isInteger(passoMin) && passoMin > 0 ? passoMin : PASSO_PADRAO_MIN;
  const agoraMs = agora.getTime();
  const livres = [];

  for (const janela of janelas) {
    // Primeiro inicio alinhado ao passo dentro da janela.
    for (let m = janela.inicioMin; m + duracao <= janela.fimMin; m += passo) {
      const inicio = dataNoMinuto(dia, m);
      const fim = new Date(inicio.getTime() + duracao * 60000);

      // Nao oferecer horario que ja passou.
      if (inicio.getTime() <= agoraMs) continue;

      const conflita = intervalosOcupados.some((o) =>
        sobrepoe(inicio.getTime(), fim.getTime(), o.ini, o.fim));
      if (conflita) continue;

      livres.push({ inicio: inicio.toISOString(), fim: fim.toISOString(), inicioMin: m });
    }
  }

  return livres;
}

/**
 * Resumo de varios dias de uma vez (link publico: faixa de dias livre/lotado).
 * Busca especialistas, expediente e agendamentos do periodo em 3 consultas e
 * calcula tudo em memoria. Por dia devolve o status e, por profissional, os
 * horarios livres.
 *
 * @param {Object} p
 * @param {string} p.clienteId
 * @param {string[]} p.especialistaIds  profissionais considerados (ativos).
 * @param {Date[]} p.dias               dias a calcular (qualquer hora do dia).
 * @param {number} p.duracao            minutos do servico.
 * @returns {Promise<Array<{ dia: string, status: 'livre'|'poucos'|'lotado'|'fechado', livres: number,
 *   horarios: Array<{ inicio: string, fim: string, especialistaId: string }> }>>}
 */
async function resumoDosDias({ clienteId, especialistaIds, dias, duracao = DURACAO_PADRAO_MIN, passoMin = PASSO_PADRAO_MIN, agora = new Date() }) {
  if (!clienteId) throw new Error('clienteId é obrigatório');
  const ids = [...new Set(especialistaIds || [])];
  if (!ids.length || !dias?.length) return [];
  const ordenados = dias.map((d) => new Date(d)).sort((x, y) => x - y);
  const inicioPeriodo = new Date(ordenados[0]); inicioPeriodo.setHours(0, 0, 0, 0);
  const fimPeriodo = new Date(ordenados[ordenados.length - 1]); fimPeriodo.setHours(23, 59, 59, 999);

  const [especialistas, cliente, agendamentos] = await Promise.all([
    prisma.especialista.findMany({ where: { clienteId, id: { in: ids }, ativo: true }, select: { id: true, jornada: true } }),
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { horarioFuncionamento: true } }),
    prisma.agendamento.findMany({
      where: { clienteId, especialistaId: { in: ids }, data: { gte: inicioPeriodo, lte: fimPeriodo }, status: { not: 'CANCELED' } },
      select: { especialistaId: true, data: true, duracao: true },
    }),
  ]);
  const passo = Number.isInteger(passoMin) && passoMin > 0 ? passoMin : PASSO_PADRAO_MIN;
  const dur = Number.isInteger(duracao) && duracao > 0 ? duracao : DURACAO_PADRAO_MIN;
  const agoraMs = agora.getTime();

  return ordenados.map((dia) => {
    const chave = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`;
    let abriu = false;
    const horarios = [];
    for (const esp of especialistas) {
      const janelas = janelasDoDia({ jornada: esp.jornada, horarioFuncionamento: cliente?.horarioFuncionamento, data: dia });
      // So conta como aberto se ainda cabe algum atendimento no futuro (hoje,
      // depois do ultimo horario possivel, o dia aparece fechado, nao lotado).
      if (janelas.some((j) => j.fimMin - dur >= j.inicioMin && dataNoMinuto(dia, j.fimMin - dur).getTime() > agoraMs)) abriu = true;
      const ocupados = agendamentos
        .filter((a) => a.especialistaId === esp.id && new Date(a.data).toDateString() === dia.toDateString())
        .map((o) => { const ini = new Date(o.data).getTime(); return { ini, fim: ini + (o.duracao || DURACAO_PADRAO_MIN) * 60000 }; });
      for (const janela of janelas) {
        for (let m = janela.inicioMin; m + dur <= janela.fimMin; m += passo) {
          const inicio = dataNoMinuto(dia, m);
          const fim = new Date(inicio.getTime() + dur * 60000);
          if (inicio.getTime() <= agoraMs) continue;
          if (ocupados.some((o) => sobrepoe(inicio.getTime(), fim.getTime(), o.ini, o.fim))) continue;
          horarios.push({ inicio: inicio.toISOString(), fim: fim.toISOString(), especialistaId: esp.id });
        }
      }
    }
    horarios.sort((x, y) => x.inicio.localeCompare(y.inicio));
    // Horarios distintos (no "qualquer profissional" o mesmo horario conta 1 vez).
    const livres = new Set(horarios.map((h) => h.inicio)).size;
    const status = !abriu ? 'fechado' : livres === 0 ? 'lotado' : livres <= 3 ? 'poucos' : 'livre';
    return { dia: chave, status, livres, horarios };
  });
}

module.exports = {
  listarHorariosLivres,
  resumoDosDias,
  HORARIO_PADRAO,
  // exportados pra teste unitario das partes puras:
  _internos: { horaParaMinutos, diaIso, janelasDoDia, sobrepoe },
};

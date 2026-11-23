// =====================================================================
// FILA DE ENCAIXE — quem esta esperando um horario que vagou.
// =====================================================================
// Ciclo:
//   1. Um horario futuro vaga (cancelou, remarcou, pediu "Remarcar" no
//      lembrete, sinal nao pago). registrarVaga() grava uma OfertaEncaixe com
//      status VAGA e avisa o dono se alguem da fila serve.
//   2. ofertar() manda a oferta pras ate 3 primeiras pessoas da fila que
//      servem (servico, profissional, dia/horario, validade). Status ABERTA,
//      vence em 30 min (nunca depois do proprio horario).
//      Com Cliente.encaixeAutomatico e vaga com +2 h de antecedencia, o
//      passo 2 acontece sozinho.
//   3. responderEnvio(): o primeiro "Quero" leva o horario (transacao com
//      lock do negocio + checagem de conflito, sem corrida). Os outros recebem
//      "ja foi preenchido, voce continua na fila".
//   4. expirarOfertas() (tarefa do worker): oferta vencida volta todo mundo
//      pra fila; vaga cujo horario passou some; entrada da fila vencida sai.
//
// Status (texto, ver schema):
//   OfertaEncaixe: VAGA | ABERTA | PREENCHIDA | EXPIRADA | CANCELADA
//   ListaEspera:   AGUARDANDO | OFERTADO | AGENDADO | DESISTIU | EXPIRADO
//   Envio.resposta: ACEITOU | RECUSOU | TARDE_DEMAIS (null = sem resposta)
// =====================================================================

const crypto = require('crypto');
const prisma = require('../prisma');
const { lockClienteAdvisory } = require('../utils/locks');
const { criarNotificacao } = require('../utils/notificacoes');
const {
  partesBRT, minutosDeHora, servicoBase, mesmoTelefone, digitos,
  diaHoraTexto, horaTexto, primeiroNome, intervaloCompetencia, competenciaBRT, round2,
} = require('./utilAgenda');

const MAX_POR_OFERTA = 3;
const VALIDADE_OFERTA_MIN = 30;
const ANTECEDENCIA_MIN_VAGA_MIN = 30; // vaga em menos de 30 min nao vale oferecer
const ANTECEDENCIA_AUTOMATICO_MS = 2 * 60 * 60 * 1000;
const DURACAO_PADRAO = 30;

// ---------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------

/**
 * Esta entrada da fila serve pra esta vaga?
 * @param {object} entrada ListaEspera (status, servico/produtoNome, especialistaId, diasSemana, horaInicio, horaFim, ate, telefone)
 * @param {object} vaga { data, servico, especialistaId }
 * @param {{ agora?: Date, telefoneExcluir?: string }} opcoes
 */
function filaServeVaga(entrada, vaga, { agora = new Date(), telefoneExcluir = null } = {}) {
  if (!entrada || !vaga) return false;
  if (entrada.status !== 'AGUARDANDO') return false;
  const dataVaga = new Date(vaga.data);
  if (dataVaga.getTime() <= agora.getTime()) return false;

  // Quem acabou de largar o horario nao recebe a propria vaga.
  if (telefoneExcluir && mesmoTelefone(entrada.telefone, telefoneExcluir)) return false;

  // Validade: "ate" vale o dia inteiro.
  if (entrada.ate) {
    const ate = partesBRT(entrada.ate).ymd;
    if (partesBRT(dataVaga).ymd > ate) return false;
  }

  // Profissional: null = qualquer um.
  if (entrada.especialistaId && entrada.especialistaId !== (vaga.especialistaId || null)) return false;

  // Servico: sem servico na fila = qualquer um; senao o nome-base tem que bater.
  const querServico = servicoBase(entrada.produtoNome || entrada.servico);
  if (querServico && querServico !== servicoBase(vaga.servico)) return false;

  // Dia da semana e faixa de horario (no fuso de Brasilia).
  const p = partesBRT(dataVaga);
  if (Array.isArray(entrada.diasSemana) && entrada.diasSemana.length > 0 && !entrada.diasSemana.map(Number).includes(p.diaSemana)) return false;
  const ini = minutosDeHora(entrada.horaInicio);
  const fim = minutosDeHora(entrada.horaFim);
  if (ini != null && p.minutos < ini) return false;
  if (fim != null && p.minutos >= fim) return false;

  return true;
}

/** Quem da fila serve, na ordem de entrada, no maximo `max`. */
function escolherCandidatos(fila, vaga, { agora = new Date(), max = MAX_POR_OFERTA, telefoneExcluir = null, excluirIds = [] } = {}) {
  const fora = new Set(excluirIds);
  return [...(fila || [])]
    .filter((e) => !fora.has(e.id) && filaServeVaga(e, vaga, { agora, telefoneExcluir }))
    .sort((a, b) => new Date(a.criadoEm) - new Date(b.criadoEm))
    .slice(0, max);
}

/** A oferta vence em 30 min, mas nunca depois do proprio horario. */
function expiraEmOferta({ agora = new Date(), dataVaga, minutos = VALIDADE_OFERTA_MIN }) {
  const limite = agora.getTime() + minutos * 60000;
  return new Date(Math.min(limite, new Date(dataVaga).getTime()));
}

function deveOfertarSozinho({ encaixeAutomatico, dataVaga, agora = new Date() }) {
  return encaixeAutomatico === true && new Date(dataVaga).getTime() - agora.getTime() >= ANTECEDENCIA_AUTOMATICO_MS;
}

function gerarToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function linkResposta(token) {
  const base = (process.env.APP_URL_PUBLICA || '').replace(/\/$/, '');
  return base ? `${base}/encaixe/${token}` : `/encaixe/${token}`;
}

// ---------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------

const SELECT_FILA = {
  id: true, clienteId: true, leadId: true, nome: true, telefone: true, produtoId: true, servico: true,
  especialistaId: true, preferencia: true, diasSemana: true, horaInicio: true, horaFim: true,
  ate: true, status: true, agendamentoId: true, criadoEm: true,
};

/** Fila AGUARDANDO do negocio, com o nome do produto resolvido (pra comparar servico). */
async function filaAguardando(clienteId, client = prisma) {
  const fila = await client.listaEspera.findMany({ where: { clienteId, status: 'AGUARDANDO' }, select: SELECT_FILA, orderBy: { criadoEm: 'asc' } });
  const idsProduto = [...new Set(fila.map((f) => f.produtoId).filter(Boolean))];
  const produtos = idsProduto.length
    ? await client.produto.findMany({ where: { id: { in: idsProduto }, clienteId }, select: { id: true, nome: true } })
    : [];
  const nomes = new Map(produtos.map((p) => [p.id, p.nome]));
  return fila.map((f) => ({ ...f, produtoNome: f.produtoId ? nomes.get(f.produtoId) || f.servico : null }));
}

/** Outro agendamento (nao cancelado) ocupa esse intervalo com o mesmo profissional? */
async function horarioOcupado(client, { clienteId, especialistaId, data, duracao, ignorarId = null }) {
  const ini = new Date(data).getTime();
  const fim = ini + (duracao || DURACAO_PADRAO) * 60000;
  const existentes = await client.agendamento.findMany({
    where: {
      clienteId, especialistaId: especialistaId || null, status: { not: 'CANCELED' },
      data: { lt: new Date(fim), gte: new Date(ini - 24 * 3600000) },
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { data: true, duracao: true },
  });
  return existentes.some((e) => {
    const a = new Date(e.data).getTime();
    return a < fim && a + (e.duracao || DURACAO_PADRAO) * 60000 > ini;
  });
}

async function telefoneDaOrigem(oferta) {
  if (!oferta.agendamentoOrigemId) return null;
  const ag = await prisma.agendamento.findUnique({ where: { id: oferta.agendamentoOrigemId }, select: { telefoneCliente: true } });
  return ag?.telefoneCliente || null;
}

async function candidatosDaVaga(oferta, { excluirIds = [], max = MAX_POR_OFERTA, agora = new Date() } = {}) {
  const fila = await filaAguardando(oferta.clienteId);
  return escolherCandidatos(fila, oferta, { agora, max, excluirIds, telefoneExcluir: await telefoneDaOrigem(oferta) });
}

async function nomeProfissional(especialistaId) {
  if (!especialistaId) return null;
  const e = await prisma.especialista.findUnique({ where: { id: especialistaId }, select: { nome: true } });
  return e ? primeiroNome(e.nome) : null;
}

async function enviarWhats(msg) {
  try {
    const { enviarMensagemTenant } = require('../services/mensagemTenant');
    return await enviarMensagemTenant(msg);
  } catch (e) {
    console.error('[encaixe] whatsapp', e?.message);
    return { ok: false };
  }
}

/**
 * Um horario futuro ficou livre. Grava a vaga, avisa o dono se tem gente na
 * fila que serve e, com o automatico ligado, ja oferta.
 * Nunca lanca: quem chama (cancelar, remarcar) nao pode quebrar por causa disto.
 * @param {{ id, clienteId, data, duracao, especialistaId, servico, status }} agendamento estado ANTES de liberar
 */
async function registrarVaga(agendamento, { agora = new Date() } = {}) {
  try {
    if (!agendamento?.clienteId || !agendamento.data) return null;
    if (agendamento.status === 'CANCELED' || agendamento.status === 'COMPLETED') return null;
    const data = new Date(agendamento.data);
    if (data.getTime() - agora.getTime() < ANTECEDENCIA_MIN_VAGA_MIN * 60000) return null;

    const jaTem = await prisma.ofertaEncaixe.findFirst({
      where: { clienteId: agendamento.clienteId, agendamentoOrigemId: agendamento.id, data, status: { in: ['VAGA', 'ABERTA'] } },
      select: { id: true },
    });
    if (jaTem) return jaTem;

    let produtoId = null;
    if (agendamento.servico) {
      const produtos = await prisma.produto.findMany({ where: { clienteId: agendamento.clienteId, tipo: 'SERVICO' }, select: { id: true, nome: true } });
      produtoId = produtos.find((p) => servicoBase(p.nome) === servicoBase(agendamento.servico))?.id || null;
    }

    const oferta = await prisma.ofertaEncaixe.create({
      data: {
        clienteId: agendamento.clienteId, agendamentoOrigemId: agendamento.id, data,
        duracao: agendamento.duracao || DURACAO_PADRAO, especialistaId: agendamento.especialistaId || null,
        produtoId, servico: agendamento.servico || null, status: 'VAGA', expiraEm: data,
      },
    });

    const candidatos = await candidatosDaVaga(oferta, { agora, max: 50 });
    if (candidatos.length === 0) return oferta;

    const cliente = await prisma.cliente.findUnique({ where: { id: oferta.clienteId }, select: { encaixeAutomatico: true } });
    const prof = await nomeProfissional(oferta.especialistaId);
    const quando = `${diaHoraTexto(data)}${prof ? ` com ${prof}` : ''}`;

    if (deveOfertarSozinho({ encaixeAutomatico: cliente?.encaixeAutomatico, dataVaga: data, agora })) {
      const r = await ofertar({ clienteId: oferta.clienteId, ofertaId: oferta.id, automatica: true, agora });
      await criarNotificacao(prisma, {
        clienteId: oferta.clienteId, tipo: 'GENERICA',
        titulo: 'Horário vago oferecido pra fila',
        mensagem: `Vagou ${quando}. A oferta foi enviada sozinha pra ${r.enviados || 0} pessoa(s) da fila. Quem aceitar primeiro fica.`,
        link: '/app/agenda/encaixe', dados: { ofertaId: oferta.id },
      }).catch(() => {});
    } else {
      await criarNotificacao(prisma, {
        clienteId: oferta.clienteId, tipo: 'GENERICA',
        titulo: 'Vagou um horário',
        mensagem: `Vagou ${quando}. ${candidatos.length} pessoa(s) da fila de encaixe servem pra esse horário.`,
        link: '/app/agenda/encaixe', dados: { ofertaId: oferta.id },
      }).catch(() => {});
    }
    return oferta;
  } catch (e) {
    console.error('[encaixe] registrarVaga', e?.message);
    return null;
  }
}

function erro(status, mensagem, codigo) {
  return Object.assign(new Error(mensagem), { status, codigo });
}

/**
 * Manda a oferta pras proximas (ate 3) pessoas da fila que servem.
 * Aceita vaga nova (VAGA) ou oferta que venceu sem ninguem aceitar (EXPIRADA)
 * enquanto o horario ainda nao passou.
 */
async function ofertar({ clienteId, ofertaId, automatica = false, agora = new Date() }) {
  const resultado = await prisma.$transaction(async (tx) => {
    await lockClienteAdvisory(tx, clienteId);
    const oferta = await tx.ofertaEncaixe.findFirst({ where: { id: ofertaId, clienteId }, include: { envios: { select: { listaEsperaId: true } } } });
    if (!oferta) throw erro(404, 'Vaga não encontrada.', 'NAO_ENCONTRADA');
    if (oferta.status === 'ABERTA') throw erro(409, 'Essa vaga já foi oferecida e está esperando resposta.', 'JA_OFERTADA');
    if (oferta.status === 'PREENCHIDA') throw erro(409, 'Essa vaga já foi preenchida.', 'PREENCHIDA');
    if (oferta.status === 'CANCELADA') throw erro(409, 'Essa vaga não está mais disponível.', 'CANCELADA');
    if (new Date(oferta.data).getTime() - agora.getTime() < 10 * 60000) throw erro(409, 'Esse horário já está muito perto ou já passou.', 'HORARIO_PASSOU');

    if (await horarioOcupado(tx, { clienteId, especialistaId: oferta.especialistaId, data: oferta.data, duracao: oferta.duracao })) {
      await tx.ofertaEncaixe.update({ where: { id: oferta.id }, data: { status: 'CANCELADA' } });
      throw erro(409, 'Esse horário já foi ocupado por outro agendamento.', 'OCUPADO');
    }

    const fila = await filaAguardando(clienteId, tx);
    let telOrigem = null;
    if (oferta.agendamentoOrigemId) {
      const ag = await tx.agendamento.findUnique({ where: { id: oferta.agendamentoOrigemId }, select: { telefoneCliente: true } });
      telOrigem = ag?.telefoneCliente || null;
    }
    const candidatos = escolherCandidatos(fila, oferta, {
      agora, telefoneExcluir: telOrigem, excluirIds: oferta.envios.map((e) => e.listaEsperaId),
    });
    if (candidatos.length === 0) throw erro(422, 'Ninguém da fila serve pra esse horário agora.', 'SEM_CANDIDATOS');

    const expiraEm = expiraEmOferta({ agora, dataVaga: oferta.data });
    await tx.ofertaEncaixe.update({ where: { id: oferta.id }, data: { status: 'ABERTA', expiraEm, automatica } });
    const envios = [];
    for (const c of candidatos) {
      const envio = await tx.ofertaEncaixeEnvio.create({ data: { ofertaId: oferta.id, listaEsperaId: c.id, token: gerarToken() } });
      await tx.listaEspera.update({ where: { id: c.id }, data: { status: 'OFERTADO' } });
      envios.push({ envio, pessoa: c });
    }
    return { oferta: { ...oferta, expiraEm }, envios };
  });

  // WhatsApp fora da transacao (fila/worker; falha nao desfaz a oferta).
  const prof = await nomeProfissional(resultado.oferta.especialistaId);
  for (const { envio, pessoa } of resultado.envios) {
    const servico = pessoa.produtoNome || pessoa.servico || resultado.oferta.servico || 'atendimento';
    const texto = `Oi, ${primeiroNome(pessoa.nome)}! Você está na nossa fila pro ${servico}${prof ? ` com ${prof}` : ''}.\n`
      + `Vagou um horário ${diaHoraTexto(resultado.oferta.data)}. Quer ficar com ele? Vale pra quem responder primeiro, até ${horaTexto(resultado.oferta.expiraEm)}.\n`
      + `Responda aqui: ${linkResposta(envio.token)}`;
    await enviarWhats({
      clienteId, para: pessoa.telefone, texto, tipo: 'conversa',
      enquete: { pergunta: 'Quer ficar com esse horário?', opcoes: ['Quero', 'Não posso'], registro: { tipo: 'OFERTA_ENCAIXE', referenciaId: envio.id } },
    });
  }
  return { ofertaId: resultado.oferta.id, enviados: resultado.envios.length, expiraEm: resultado.oferta.expiraEm };
}

/**
 * Resposta de quem recebeu a oferta (link, enquete do WhatsApp).
 * @param {{ envioId?: string, token?: string, acao: 'ACEITAR'|'RECUSAR', agora?: Date }} p
 * @returns {Promise<{ ok: boolean, resultado: string, mensagem: string, agendamentoId?: string }>}
 */
async function responderEnvio({ envioId = null, token = null, acao, agora = new Date() }) {
  if (acao !== 'ACEITAR' && acao !== 'RECUSAR') throw erro(422, 'Resposta inválida.', 'ACAO_INVALIDA');
  const base = await prisma.ofertaEncaixeEnvio.findFirst({
    where: envioId ? { id: envioId } : { token: String(token || '') },
    select: { id: true, oferta: { select: { clienteId: true } } },
  });
  if (!base) throw erro(404, 'Oferta não encontrada.', 'NAO_ENCONTRADA');
  const clienteId = base.oferta.clienteId;

  const r = await prisma.$transaction(async (tx) => {
    await lockClienteAdvisory(tx, clienteId);
    const envio = await tx.ofertaEncaixeEnvio.findUnique({ where: { id: base.id }, include: { oferta: true, listaEspera: true } });
    const { oferta, listaEspera: pessoa } = envio;

    if (envio.resposta === 'ACEITOU') return { ok: true, resultado: 'JA_ACEITOU', agendamentoId: oferta.agendamentoNovoId };
    if (envio.resposta) return { ok: false, resultado: 'JA_RESPONDIDO', respostaAnterior: envio.resposta };

    const voltaPraFila = async () => {
      if (pessoa.status === 'OFERTADO') await tx.listaEspera.update({ where: { id: pessoa.id }, data: { status: 'AGUARDANDO' } });
    };

    if (acao === 'RECUSAR') {
      await tx.ofertaEncaixeEnvio.update({ where: { id: envio.id }, data: { resposta: 'RECUSOU', respostaEm: agora } });
      await voltaPraFila();
      // Todo mundo recusou: a vaga volta pra ser oferecida a outras pessoas.
      const pendentes = await tx.ofertaEncaixeEnvio.count({ where: { ofertaId: oferta.id, resposta: null } });
      let todosRecusaram = false;
      if (pendentes === 0 && oferta.status === 'ABERTA') {
        await tx.ofertaEncaixe.update({ where: { id: oferta.id }, data: { status: 'EXPIRADA', expiraEm: agora } });
        todosRecusaram = true;
      }
      return { ok: true, resultado: 'RECUSADO', todosRecusaram, oferta };
    }

    // ACEITAR
    const vencida = oferta.status !== 'ABERTA' || new Date(oferta.expiraEm).getTime() <= agora.getTime();
    if (vencida) {
      await tx.ofertaEncaixeEnvio.update({ where: { id: envio.id }, data: { resposta: 'TARDE_DEMAIS', respostaEm: agora } });
      await voltaPraFila();
      return { ok: false, resultado: 'TARDE_DEMAIS' };
    }
    if (await horarioOcupado(tx, { clienteId, especialistaId: oferta.especialistaId, data: oferta.data, duracao: oferta.duracao })) {
      await tx.ofertaEncaixe.update({ where: { id: oferta.id }, data: { status: 'CANCELADA' } });
      await tx.ofertaEncaixeEnvio.update({ where: { id: envio.id }, data: { resposta: 'TARDE_DEMAIS', respostaEm: agora } });
      await voltaPraFila();
      const outros = await tx.ofertaEncaixeEnvio.findMany({ where: { ofertaId: oferta.id, resposta: null }, select: { listaEsperaId: true } });
      await tx.listaEspera.updateMany({ where: { id: { in: outros.map((o) => o.listaEsperaId) }, status: 'OFERTADO' }, data: { status: 'AGUARDANDO' } });
      return { ok: false, resultado: 'TARDE_DEMAIS' };
    }

    // Lead: reaproveita o da fila, senao pelo telefone, senao cria.
    let leadId = pessoa.leadId;
    if (!leadId) {
      const leads = await tx.lead.findMany({ where: { clienteId, telefone: { not: null } }, select: { id: true, telefone: true } });
      leadId = leads.find((l) => mesmoTelefone(l.telefone, pessoa.telefone))?.id || null;
      if (!leadId) {
        const novo = await tx.lead.create({ data: { clienteId, nome: pessoa.nome, telefone: digitos(pessoa.telefone), origem: 'ENCAIXE', valor: 0 } });
        leadId = novo.id;
      }
    }
    const origem = oferta.agendamentoOrigemId
      ? await tx.agendamento.findUnique({ where: { id: oferta.agendamentoOrigemId }, select: { preco: true } })
      : null;

    const ag = await tx.agendamento.create({
      data: {
        clienteId, leadId, especialistaId: oferta.especialistaId, nomeCliente: pessoa.nome,
        telefoneCliente: pessoa.telefone, data: oferta.data, duracao: oferta.duracao,
        servico: oferta.servico || pessoa.servico, preco: origem?.preco ?? 0,
        origem: 'MANUAL', status: 'CONFIRMED', confirmadoEm: agora, confirmadoPor: 'CLIENTE_ENCAIXE',
        observacoes: 'Encaixe pela fila de espera.',
      },
    });
    await tx.historicoAgendamento.create({ data: { agendamentoId: ag.id, acao: 'CRIADO', usuarioNome: pessoa.nome, origem: 'ENCAIXE' } });
    await tx.ofertaEncaixe.update({ where: { id: oferta.id }, data: { status: 'PREENCHIDA', aceitaPorEnvioId: envio.id, agendamentoNovoId: ag.id } });
    await tx.ofertaEncaixeEnvio.update({ where: { id: envio.id }, data: { resposta: 'ACEITOU', respostaEm: agora } });
    await tx.listaEspera.update({ where: { id: pessoa.id }, data: { status: 'AGENDADO', agendamentoId: ag.id, leadId } });

    const outros = await tx.ofertaEncaixeEnvio.findMany({ where: { ofertaId: oferta.id, resposta: null }, include: { listaEspera: true } });
    await tx.listaEspera.updateMany({ where: { id: { in: outros.map((o) => o.listaEsperaId) }, status: 'OFERTADO' }, data: { status: 'AGUARDANDO' } });
    return { ok: true, resultado: 'ACEITO', agendamentoId: ag.id, oferta, pessoa, outros: outros.map((o) => o.listaEspera) };
  });

  const prof = r.oferta ? await nomeProfissional(r.oferta.especialistaId) : null;
  if (r.resultado === 'ACEITO') {
    const quando = `${diaHoraTexto(r.oferta.data)}${prof ? ` com ${prof}` : ''}`;
    for (const o of r.outros) {
      await enviarWhats({ clienteId, para: o.telefone, tipo: 'conversa', texto: `Oi, ${primeiroNome(o.nome)}! O horário de ${diaHoraTexto(r.oferta.data)} já foi preenchido. Você continua na fila e avisamos no próximo que vagar.` });
    }
    await criarNotificacao(prisma, {
      clienteId, tipo: 'GENERICA', titulo: 'Horário preenchido pela fila',
      mensagem: `${r.pessoa.nome} ficou com ${quando}. Já está confirmada na agenda.`,
      link: '/app/agenda', dados: { agendamentoId: r.agendamentoId },
    }).catch(() => {});
    return { ok: true, resultado: 'ACEITO', agendamentoId: r.agendamentoId, mensagem: `Pronto, é seu! ${quando[0].toUpperCase()}${quando.slice(1)}.` };
  }
  if (r.resultado === 'RECUSADO') {
    if (r.todosRecusaram) {
      await criarNotificacao(prisma, {
        clienteId, tipo: 'GENERICA', titulo: 'Ninguém aceitou o encaixe',
        mensagem: `Quem recebeu a oferta de ${diaHoraTexto(r.oferta.data)} não pode. Você pode oferecer pras próximas pessoas da fila.`,
        link: '/app/agenda/encaixe', dados: { ofertaId: r.oferta.id },
      }).catch(() => {});
    }
    return { ok: true, resultado: 'RECUSADO', mensagem: 'Tudo bem! Você continua na fila e avisamos no próximo horário que vagar.' };
  }
  if (r.resultado === 'JA_ACEITOU') return { ok: true, resultado: 'ACEITO', agendamentoId: r.agendamentoId, mensagem: 'Esse horário já é seu. Até lá!' };
  if (r.resultado === 'JA_RESPONDIDO') {
    return { ok: false, resultado: 'JA_RESPONDIDO', mensagem: r.respostaAnterior === 'RECUSOU' ? 'Você já respondeu que não pode. Continua na fila.' : 'Esse horário já foi preenchido. Você continua na fila.' };
  }
  return { ok: false, resultado: 'TARDE_DEMAIS', mensagem: 'Esse horário já foi preenchido. Você continua na fila e avisamos no próximo que vagar.' };
}

// ---------------------------------------------------------------------
// Entrada na fila (recepcao e link publico)
// ---------------------------------------------------------------------

/**
 * Valida e normaliza o pedido de entrar na fila. Pura.
 * @returns {{ erro: string, campos: string[] } | { dados: object }}
 */
function normalizarEntradaFila(body = {}, { agora = new Date() } = {}) {
  const campos = [];
  const nome = typeof body.nome === 'string' ? body.nome.trim().slice(0, 80) : '';
  const telefone = digitos(body.telefone);
  if (nome.length < 2) campos.push('nome');
  if (telefone.length < 10 || telefone.length > 13) campos.push('telefone');

  let diasSemana = null;
  if (body.diasSemana != null) {
    if (!Array.isArray(body.diasSemana) || body.diasSemana.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) campos.push('diasSemana');
    else if (body.diasSemana.length > 0 && body.diasSemana.length < 7) diasSemana = [...new Set(body.diasSemana)].sort();
  }
  const horaInicio = body.horaInicio ? String(body.horaInicio) : null;
  const horaFim = body.horaFim ? String(body.horaFim) : null;
  if (horaInicio && minutosDeHora(horaInicio) == null) campos.push('horaInicio');
  if (horaFim && minutosDeHora(horaFim) == null) campos.push('horaFim');
  if (horaInicio && horaFim && minutosDeHora(horaFim) <= minutosDeHora(horaInicio)) campos.push('horaFim');

  let ate = null;
  if (body.ate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.ate))) campos.push('ate');
    else {
      ate = new Date(`${body.ate}T23:59:59.000-03:00`);
      if (Number.isNaN(ate.getTime()) || String(body.ate) < partesBRT(agora).ymd) campos.push('ate');
    }
  }
  const preferencia = typeof body.preferencia === 'string' && body.preferencia.trim() ? body.preferencia.trim().slice(0, 200) : null;
  const idOuNull = (v) => (typeof v === 'string' && v ? v : null);

  if (campos.length) return { erro: 'Confira os campos destacados.', campos: [...new Set(campos)] };
  return {
    dados: {
      nome, telefone, diasSemana, horaInicio, horaFim, ate, preferencia,
      produtoId: idOuNull(body.produtoId), especialistaId: idOuNull(body.especialistaId), leadId: idOuNull(body.leadId),
    },
  };
}

/** Grava na fila, conferindo que servico/profissional/lead sao do negocio. */
async function adicionarNaFila({ clienteId, dados }) {
  let servico = null;
  if (dados.produtoId) {
    const p = await prisma.produto.findFirst({ where: { id: dados.produtoId, clienteId, tipo: 'SERVICO' }, select: { nome: true } });
    if (!p) throw erro(422, 'Serviço inválido.', 'CAMPOS');
    servico = p.nome;
  }
  if (dados.especialistaId) {
    const e = await prisma.especialista.findFirst({ where: { id: dados.especialistaId, clienteId }, select: { id: true } });
    if (!e) throw erro(422, 'Profissional inválido.', 'CAMPOS');
  }
  if (dados.leadId) {
    const l = await prisma.lead.findFirst({ where: { id: dados.leadId, clienteId }, select: { id: true } });
    if (!l) throw erro(422, 'Cliente inválida.', 'CAMPOS');
  }
  const ativos = await prisma.listaEspera.findMany({
    where: { clienteId, status: { in: ['AGUARDANDO', 'OFERTADO'] } }, select: { telefone: true, produtoId: true },
  });
  if (ativos.some((a) => mesmoTelefone(a.telefone, dados.telefone) && (a.produtoId || null) === (dados.produtoId || null))) {
    throw erro(409, 'Essa pessoa já está na fila para esse serviço.', 'JA_NA_FILA');
  }
  return prisma.listaEspera.create({ data: { clienteId, ...dados, servico } });
}

/** Tarefa do worker: vence ofertas, vagas passadas e entradas da fila vencidas. */
async function expirarOfertas(agora = new Date()) {
  const vencidas = await prisma.ofertaEncaixe.findMany({
    where: { status: 'ABERTA', expiraEm: { lte: agora } }, select: { id: true, clienteId: true, data: true }, take: 200,
  });
  for (const o of vencidas) {
    const mudou = await prisma.ofertaEncaixe.updateMany({ where: { id: o.id, status: 'ABERTA' }, data: { status: 'EXPIRADA' } });
    if (mudou.count === 0) continue; // alguem aceitou no meio do caminho
    const pendentes = await prisma.ofertaEncaixeEnvio.findMany({ where: { ofertaId: o.id, resposta: null }, select: { listaEsperaId: true } });
    await prisma.listaEspera.updateMany({ where: { id: { in: pendentes.map((p) => p.listaEsperaId) }, status: 'OFERTADO' }, data: { status: 'AGUARDANDO' } });
    if (new Date(o.data).getTime() > agora.getTime()) {
      await criarNotificacao(prisma, {
        clienteId: o.clienteId, tipo: 'GENERICA', titulo: 'Oferta de encaixe venceu',
        mensagem: `Ninguém aceitou o horário de ${diaHoraTexto(o.data)} a tempo. Você pode oferecer pras próximas pessoas da fila.`,
        link: '/app/agenda/encaixe', dados: { ofertaId: o.id },
      }).catch(() => {});
    }
  }
  // Vaga que ninguem ofertou e o horario chegou: some da tela.
  await prisma.ofertaEncaixe.updateMany({ where: { status: { in: ['VAGA', 'EXPIRADA'] }, data: { lte: agora } }, data: { status: 'CANCELADA' } }).catch(() => {});
  // Fila com validade vencida.
  const hoje = new Date(`${partesBRT(agora).ymd}T03:00:00.000Z`);
  await prisma.listaEspera.updateMany({ where: { status: 'AGUARDANDO', ate: { lt: hoje } }, data: { status: 'EXPIRADO' } });
  return { ofertasVencidas: vencidas.length };
}

/** Historico do mes: vagas, preenchidas e valor recuperado (do banco). */
async function resumoDoMes(clienteId, competencia = competenciaBRT()) {
  const intervalo = intervaloCompetencia(competencia);
  const ofertas = await prisma.ofertaEncaixe.findMany({
    where: { clienteId, criadoEm: { gte: intervalo.inicio, lt: intervalo.fim } },
    select: { status: true, agendamentoNovoId: true },
  });
  const ids = ofertas.map((o) => o.agendamentoNovoId).filter(Boolean);
  const novos = ids.length ? await prisma.agendamento.findMany({ where: { id: { in: ids }, clienteId }, select: { preco: true, status: true } }) : [];
  return {
    competencia,
    vagas: ofertas.length,
    ofertadas: ofertas.filter((o) => o.status !== 'VAGA').length,
    preenchidas: ofertas.filter((o) => o.status === 'PREENCHIDA').length,
    valorRecuperado: round2(novos.filter((a) => a.status !== 'CANCELED').reduce((s, a) => s + (a.preco || 0), 0)),
  };
}

module.exports = {
  // puras
  filaServeVaga, escolherCandidatos, expiraEmOferta, deveOfertarSozinho, linkResposta, normalizarEntradaFila,
  // banco
  filaAguardando, candidatosDaVaga, horarioOcupado, registrarVaga, ofertar, responderEnvio, adicionarNaFila,
  expirarOfertas, resumoDoMes,
  MAX_POR_OFERTA, VALIDADE_OFERTA_MIN,
};

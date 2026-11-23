// Fila de encaixe: lista de espera, ofertas e resposta.
// Montado em /encaixe (src/index.js). Frente A da fase 2.
//
//   GET   /encaixe                      -> vagas, fila, automatico e historico do mes
//   POST  /encaixe/fila                 -> pôr cliente na fila (recepcao)
//   PATCH /encaixe/fila/:id             -> { status: DESISTIU | AGUARDANDO } (tirar / voltar)
//   POST  /encaixe/vagas/:id/ofertar    -> manda a oferta pras proximas 3 da fila
//   POST  /encaixe/vagas/:id/descartar  -> nao oferecer essa vaga
// Regra toda em src/agenda/encaixe.js.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerTenant, requerModuloLiberado, requerPermissao } = require('../middlewares/permissoes.middleware');
const encaixe = require('../agenda/encaixe');
const { primeiroNome, competenciaBRT } = require('../agenda/utilAgenda');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerTenant);
roteador.use(requerModuloLiberado('AGENDA'));

function clienteDe(req, res) {
  const id = req.usuario?.clienteId;
  if (!id) res.status(403).json({ erro: 'Escolha um negócio para ver a fila de encaixe.' });
  return id;
}

function responderErro(res, e, contexto) {
  if (e?.status) return res.status(e.status).json({ erro: e.message, codigo: e.codigo });
  console.error(`[encaixe/${contexto}]`, e);
  return res.status(500).json({ erro: 'Erro na fila de encaixe. Tente de novo.' });
}

roteador.get('/', requerPermissao('AGENDA', 'visualizar'), async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const agora = new Date();

    const [ofertas, filaBruta, cliente, especialistas] = await Promise.all([
      prisma.ofertaEncaixe.findMany({
        where: {
          clienteId,
          OR: [
            { status: { in: ['VAGA', 'ABERTA', 'EXPIRADA'] }, data: { gt: agora } },
            { status: 'PREENCHIDA', criadoEm: { gte: new Date(agora.getTime() - 2 * 86400000) } },
          ],
        },
        include: { envios: { include: { listaEspera: { select: { id: true, nome: true, telefone: true } } }, orderBy: { enviadoEm: 'asc' } } },
        orderBy: { data: 'asc' },
        take: 30,
      }),
      prisma.listaEspera.findMany({
        where: {
          clienteId,
          OR: [
            { status: { in: ['AGUARDANDO', 'OFERTADO'] } },
            { status: 'AGENDADO', atualizadoEm: { gte: new Date(agora.getTime() - 7 * 86400000) } },
          ],
        },
        include: { envios: { orderBy: { enviadoEm: 'desc' }, take: 1, select: { resposta: true, enviadoEm: true, ofertaId: true } } },
        orderBy: { criadoEm: 'asc' },
        take: 200,
      }),
      prisma.cliente.findUnique({ where: { id: clienteId }, select: { encaixeAutomatico: true } }),
      prisma.especialista.findMany({ where: { clienteId }, select: { id: true, nome: true } }),
    ]);
    const nomeEsp = new Map(especialistas.map((e) => [e.id, e.nome]));

    // Origem de cada vaga (quem largou o horario) e o novo agendamento.
    const idsAg = ofertas.flatMap((o) => [o.agendamentoOrigemId, o.agendamentoNovoId]).filter(Boolean);
    const ags = idsAg.length ? await prisma.agendamento.findMany({ where: { id: { in: idsAg }, clienteId }, select: { id: true, nomeCliente: true, status: true, preco: true } }) : [];
    const agPorId = new Map(ags.map((a) => [a.id, a]));
    const fila = await encaixe.filaAguardando(clienteId);

    const vagas = [];
    for (const o of ofertas) {
      // Vaga ainda nao ofertada que alguem ocupou por fora: some.
      if ((o.status === 'VAGA' || o.status === 'EXPIRADA') && await encaixe.horarioOcupado(prisma, { clienteId, especialistaId: o.especialistaId, data: o.data, duracao: o.duracao })) {
        await prisma.ofertaEncaixe.updateMany({ where: { id: o.id, status: o.status }, data: { status: 'CANCELADA' } });
        continue;
      }
      const jaReceberam = o.envios.map((e) => e.listaEsperaId);
      const telOrigem = o.agendamentoOrigemId ? (await prisma.agendamento.findUnique({ where: { id: o.agendamentoOrigemId }, select: { telefoneCliente: true } }))?.telefoneCliente : null;
      const candidatos = o.status === 'VAGA' || o.status === 'EXPIRADA'
        ? encaixe.escolherCandidatos(fila, o, { agora, max: 50, excluirIds: jaReceberam, telefoneExcluir: telOrigem })
        : [];
      const origem = o.agendamentoOrigemId ? agPorId.get(o.agendamentoOrigemId) : null;
      const novo = o.agendamentoNovoId ? agPorId.get(o.agendamentoNovoId) : null;
      vagas.push({
        id: o.id, status: o.status, data: o.data, duracao: o.duracao, servico: o.servico,
        especialistaId: o.especialistaId, profissional: o.especialistaId ? nomeEsp.get(o.especialistaId) || null : null,
        expiraEm: o.expiraEm, automatica: o.automatica, criadoEm: o.criadoEm,
        origem: origem ? { nome: origem.nomeCliente } : null,
        novoAgendamento: novo ? { id: novo.id, nome: novo.nomeCliente } : null,
        candidatos: { total: candidatos.length, primeiros: candidatos.slice(0, encaixe.MAX_POR_OFERTA).map((c) => primeiroNome(c.nome)) },
        envios: o.envios.map((e) => ({
          id: e.id, nome: e.listaEspera.nome, resposta: e.resposta, enviadoEm: e.enviadoEm, respostaEm: e.respostaEm,
          aceitou: o.aceitaPorEnvioId === e.id,
        })),
      });
    }

    res.json({
      automatico: !!cliente?.encaixeAutomatico,
      vagas,
      fila: filaBruta.map((f) => ({
        id: f.id, nome: f.nome, telefone: f.telefone, servico: f.servico, produtoId: f.produtoId,
        especialistaId: f.especialistaId, profissional: f.especialistaId ? nomeEsp.get(f.especialistaId) || null : null,
        preferencia: f.preferencia, diasSemana: f.diasSemana, horaInicio: f.horaInicio, horaFim: f.horaFim,
        ate: f.ate, status: f.status, criadoEm: f.criadoEm, ultimaResposta: f.envios[0]?.resposta || null,
      })),
      mes: await encaixe.resumoDoMes(clienteId, competenciaBRT(agora)),
    });
  } catch (e) {
    responderErro(res, e, 'listar');
  }
});

roteador.post('/fila', requerPermissao('AGENDA', 'criar'), async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const r = encaixe.normalizarEntradaFila(req.body || {});
    if (r.erro) return res.status(422).json({ erro: r.erro, campos: r.campos });
    const entrada = await encaixe.adicionarNaFila({ clienteId, dados: r.dados });
    res.status(201).json(entrada);
  } catch (e) {
    responderErro(res, e, 'fila');
  }
});

roteador.patch('/fila/:id', requerPermissao('AGENDA', 'editar'), async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const { status } = req.body || {};
    if (status !== 'DESISTIU' && status !== 'AGUARDANDO') return res.status(422).json({ erro: 'Status inválido.', campos: ['status'] });
    const entrada = await prisma.listaEspera.findFirst({ where: { id: req.params.id, clienteId }, select: { id: true, status: true } });
    if (!entrada) return res.status(404).json({ erro: 'Pessoa não encontrada na fila.' });
    if (entrada.status === 'AGENDADO') return res.status(409).json({ erro: 'Essa pessoa já foi encaixada na agenda.' });
    const atualizada = await prisma.listaEspera.update({ where: { id: entrada.id }, data: { status } });
    res.json(atualizada);
  } catch (e) {
    responderErro(res, e, 'fila-status');
  }
});

roteador.post('/vagas/:id/ofertar', requerPermissao('AGENDA', 'editar'), async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const r = await encaixe.ofertar({ clienteId, ofertaId: req.params.id });
    res.json(r);
  } catch (e) {
    responderErro(res, e, 'ofertar');
  }
});

roteador.post('/vagas/:id/descartar', requerPermissao('AGENDA', 'editar'), async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const r = await prisma.ofertaEncaixe.updateMany({
      where: { id: req.params.id, clienteId, status: { in: ['VAGA', 'EXPIRADA'] } }, data: { status: 'CANCELADA' },
    });
    if (!r.count) return res.status(409).json({ erro: 'Essa vaga não pode mais ser descartada.' });
    res.json({ ok: true });
  } catch (e) {
    responderErro(res, e, 'descartar');
  }
});

module.exports = roteador;

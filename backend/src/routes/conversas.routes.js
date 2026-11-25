// Caixa de entrada do WhatsApp (tela /app/whatsapp). Lê as conversas gravadas
// por conversas/servico.js e deixa a equipe responder pelo número conectado.
//
//   GET  /conversas/canal                 número conectado? + não lidas (menu)
//   GET  /conversas/atalhos               quais atalhos de resposta existem
//   GET  /conversas/atalhos/horarios      texto com horários livres de um dia
//   GET  /conversas                       lista (busca, filtro, cursor)
//   GET  /conversas/:id                   conversa + ficha do cliente (lead)
//   GET  /conversas/:id/mensagens         mensagens (paginado, mais novas por último)
//   POST /conversas/:id/lida              zera as não lidas
//   POST /conversas/:id/mensagens         equipe responde (pausa o bot)
//   POST /conversas/:id/pausar            { horas | null } bot quieto nesta conversa
//   POST /conversas/:id/retomar           devolve ao bot
//
// Sempre preso ao negócio do usuário (clienteId do banco): id de outro negócio
// = 404. Gating: módulo CRM; ler = CRM visualizar, responder/pausar = CRM editar.
// Envio: respeita WHATSAPP_ENVIO_REAL / BAILEYS_ENVIO_REAL — com a trava
// desligada a resposta só é gravada (status SIMULADA) e logada.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerModuloLiberado, requerPermissao, ehAdmin } = require('../middlewares/permissoes.middleware');
const regras = require('../conversas/regras');
const conversas = require('../conversas/servico');
const { temRecurso } = require('../planos/recursos');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use((req, res, next) => {
  if (ehAdmin(req.usuario) || !req.usuario?.clienteId) return res.status(403).json({ erro: 'Disponível só para a conta do negócio.' });
  return next();
});
roteador.use(requerModuloLiberado('CRM'));

const ver = requerPermissao('CRM', 'visualizar');
const responder = requerPermissao('CRM', 'editar');

const CAMPOS_BOT_CANAL = {
  id: true, provedorCanal: true, identificadorCanal: true, credencialCanalId: true, verifyTokenCanal: true,
  statusConexaoBaileys: true, baileysNumeroConectado: true, telefone: true,
};

async function canalDoNegocio(clienteId) {
  const bots = await prisma.bot.findMany({ where: { clienteId }, select: CAMPOS_BOT_CANAL, orderBy: { criadoEm: 'asc' } });
  return regras.canalConectado(bots);
}

async function conversaDoNegocio(req) {
  const id = String(req.params.id || '');
  if (!id || id.length > 64) return null;
  return prisma.conversa.findFirst({ where: { id, clienteId: req.usuario.clienteId } });
}

const naoEncontrada = (res) => res.status(404).json({ erro: 'Conversa não encontrada.' });

function erro500(res, rotulo, e) {
  console.error(`[conversas ${rotulo}]`, e?.message || e);
  return res.status(500).json({ erro: 'Não foi possível carregar agora. Tente de novo.' });
}

/** Nome mostrado: lead do CRM > nome do perfil do WhatsApp > telefone. */
async function comNomes(lista) {
  const ids = [...new Set(lista.map((c) => c.leadId).filter(Boolean))];
  const leads = ids.length
    ? await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })
    : [];
  const nomes = new Map(leads.map((l) => [l.id, l.nome]));
  return lista.map((c) => ({ ...conversas.resumoConversa(c), nome: nomes.get(c.leadId) || c.nomeContato || null, telefoneEnvio: c.telefoneEnvio }));
}

// ---------- canal e atalhos ----------

roteador.get('/canal', ver, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const [canal, soma] = await Promise.all([
      canalDoNegocio(clienteId),
      prisma.conversa.aggregate({ where: { clienteId }, _sum: { naoLidas: true } }),
    ]);
    res.json({
      conectado: canal.conectado,
      provedor: canal.provedor,
      numero: canal.numero,
      envioReal: canal.conectado ? regras.envioRealLigado(canal.provedor) : false,
      naoLidas: soma._sum.naoLidas || 0,
    });
  } catch (e) {
    erro500(res, 'canal', e);
  }
});

roteador.get('/atalhos', ver, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const cliente = await prisma.cliente.findUnique({
      where: { id: clienteId },
      select: { slugPublico: true, modulosLiberados: true, plano: true, statusAssinatura: true, trialAte: true },
    });
    const agenda = cliente?.modulosLiberados?.AGENDA === true;
    const base = (process.env.APP_URL_PUBLICA || process.env.VITE_URL_PUBLICA || '').replace(/\/$/, '');
    const link = agenda && cliente?.slugPublico && base && temRecurso(cliente, 'linkAgendamento')
      ? `${base}/agendar/${cliente.slugPublico}` : null;

    // Pix: dono/administrador, módulo PAGAMENTOS e provedor configurado (mesma
    // regra da rota /pagamentos/cobrancas, que é quem gera o Pix).
    let pix = false;
    if (['CLIENT', 'ADMINISTRADOR'].includes(req.usuario.perfil) && cliente?.modulosLiberados?.PAGAMENTOS === true) {
      const cfg = await prisma.configuracaoPagamento.findUnique({ where: { clienteId }, select: { ativo: true } });
      pix = Boolean(cfg?.ativo);
    }
    res.json({ linkAgendamento: link, horarios: agenda, pix });
  } catch (e) {
    erro500(res, 'atalhos', e);
  }
});

roteador.get('/atalhos/horarios', ver, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const dia = String(req.query.dia || '');
    const rotulo = regras.rotuloDia(dia);
    if (!rotulo) return res.status(422).json({ erro: 'Escolha um dia válido.', campos: ['dia'] });
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const data = new Date(`${dia}T12:00:00`);
    if (data < hoje || data.getTime() - hoje.getTime() > 60 * 86400000) {
      return res.status(422).json({ erro: 'Escolha um dia entre hoje e os próximos 60 dias.', campos: ['dia'] });
    }
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { modulosLiberados: true } });
    if (cliente?.modulosLiberados?.AGENDA !== true) return res.status(403).json({ erro: 'A agenda não está liberada para este negócio.' });

    const { listarHorariosLivres } = require('../services/agendaSlots');
    const profissionais = await prisma.especialista.findMany({
      where: { clienteId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' }, take: 8,
    });
    const porProfissional = [];
    for (const p of profissionais) {
      const livres = await listarHorariosLivres({ clienteId, especialistaId: p.id, data }).catch(() => []);
      porProfissional.push({
        nome: String(p.nome || '').trim().split(/\s+/)[0] || 'Equipe',
        horarios: livres.slice(0, 6).map((h) => regras.horaDeMinutos(h.inicioMin)),
      });
    }
    res.json({ rotulo, profissionais: porProfissional, texto: regras.textoHorarios(rotulo, porProfissional) });
  } catch (e) {
    erro500(res, 'horarios', e);
  }
});

// ---------- lista ----------

roteador.get('/', ver, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const filtro = regras.FILTROS.includes(req.query.filtro) ? req.query.filtro : 'todas';
    const limite = regras.lerTamanhoPagina(req.query.limite);
    const antes = regras.lerCursorData(req.query.antes);
    const agora = new Date();
    const where = regras.filtroLista({ clienteId, busca: req.query.busca, filtro, agora });
    if (antes) where.ultimaMensagemEm = { lt: antes };

    const contar = (f) => prisma.conversa.count({ where: regras.filtroLista({ clienteId, busca: req.query.busca, filtro: f, agora }) });
    const [lista, ...totais] = await Promise.all([
      prisma.conversa.findMany({ where, orderBy: { ultimaMensagemEm: 'desc' }, take: limite + 1 }),
      ...regras.FILTROS.map(contar),
    ]);
    const temMais = lista.length > limite;
    const pagina = lista.slice(0, limite);
    res.json({
      conversas: await comNomes(pagina),
      proximo: temMais ? pagina[pagina.length - 1].ultimaMensagemEm : null,
      contagens: Object.fromEntries(regras.FILTROS.map((f, i) => [f, totais[i]])),
    });
  } catch (e) {
    erro500(res, 'lista', e);
  }
});

// ---------- uma conversa ----------

async function fichaDoLead(clienteId, leadId) {
  if (!leadId) return null;
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, clienteId },
    select: {
      id: true, nome: true, telefone: true, email: true, valor: true, observacoes: true, tags: true,
      dataNascimento: true, origem: true, criadoEm: true, etapa: { select: { nome: true, cor: true } },
    },
  });
  if (!lead) return null;
  const agora = new Date();
  const [vendas, ultimaVenda, proximo] = await Promise.all([
    prisma.venda.aggregate({ where: { clienteId, leadId, status: 'COMPLETED' }, _count: true, _sum: { valor: true } }),
    prisma.venda.findFirst({ where: { clienteId, leadId, status: 'COMPLETED' }, orderBy: { data: 'desc' }, select: { data: true, valor: true, metodoPagamento: true } }),
    prisma.agendamento.findFirst({
      where: { clienteId, leadId, data: { gte: agora }, status: { in: ['PENDING', 'CONFIRMED'] } },
      orderBy: { data: 'asc' },
      select: { id: true, data: true, servico: true, status: true, especialista: { select: { nome: true } } },
    }),
  ]);
  return {
    ...lead,
    compras: vendas._count || 0,
    totalGasto: vendas._sum.valor || 0,
    ultimaCompra: ultimaVenda,
    proximoHorario: proximo,
  };
}

roteador.get('/:id', ver, async (req, res) => {
  try {
    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);
    const [[resumo], ficha, canal] = await Promise.all([
      comNomes([conversa]),
      fichaDoLead(req.usuario.clienteId, conversa.leadId),
      canalDoNegocio(req.usuario.clienteId),
    ]);
    const hojeIni = new Date(); hojeIni.setHours(0, 0, 0, 0);
    const autoHoje = await prisma.mensagemConversa.count({ where: { conversaId: conversa.id, origem: 'BOT', criadoEm: { gte: hojeIni } } });
    res.json({
      conversa: {
        ...resumo,
        janelaAte: regras.janelaAte({ canal: canal.provedor || conversa.canal, ultimaEntradaEm: conversa.ultimaEntradaEm }),
      },
      ficha,
      canal: { conectado: canal.conectado, provedor: canal.provedor, envioReal: canal.conectado ? regras.envioRealLigado(canal.provedor) : false },
      respostasDoBotHoje: autoHoje,
    });
  } catch (e) {
    erro500(res, 'detalhe', e);
  }
});

roteador.get('/:id/mensagens', ver, async (req, res) => {
  try {
    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);
    const limite = regras.lerTamanhoPagina(req.query.limite);
    const antes = regras.lerCursorData(req.query.antes);
    const lista = await prisma.mensagemConversa.findMany({
      where: { conversaId: conversa.id, clienteId: req.usuario.clienteId, ...(antes ? { criadoEm: { lt: antes } } : {}) },
      orderBy: { criadoEm: 'desc' },
      take: limite + 1,
      select: conversas.CAMPOS_MENSAGEM,
    });
    const temMais = lista.length > limite;
    const pagina = lista.slice(0, limite).reverse(); // mais antiga primeiro
    res.json({ mensagens: pagina, temMais, proximo: temMais ? pagina[0].criadoEm : null });
  } catch (e) {
    erro500(res, 'mensagens', e);
  }
});

roteador.post('/:id/lida', ver, async (req, res) => {
  try {
    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);
    if (conversa.naoLidas > 0) {
      const atualizada = await prisma.conversa.update({ where: { id: conversa.id }, data: { naoLidas: 0 } });
      await conversas.publicar(req.usuario.clienteId, 'conversa_atualizada', { conversa: conversas.resumoConversa(atualizada) });
    }
    res.json({ ok: true });
  } catch (e) {
    erro500(res, 'lida', e);
  }
});

// ---------- responder ----------

roteador.post('/:id/mensagens', responder, async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const lido = regras.validarTexto(req.body?.texto);
    if (lido.erro) return res.status(422).json({ erro: lido.erro, campos: ['texto'] });

    const conversa = await conversaDoNegocio(req);
    if (!conversa) return naoEncontrada(res);

    const canal = await canalDoNegocio(clienteId);
    if (!canal.conectado) {
      return res.status(409).json({ erro: 'Conecte o WhatsApp em "Bots e conexão" para responder.', codigo: 'WHATSAPP_DESCONECTADO' });
    }
    if (!regras.dentroDaJanela({ canal: canal.provedor, ultimaEntradaEm: conversa.ultimaEntradaEm })) {
      return res.status(422).json({
        erro: 'No WhatsApp oficial só dá para responder até 24 horas depois da última mensagem do cliente. Depois disso, use um modelo aprovado (campanha).',
        codigo: 'FORA_DA_JANELA',
      });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } });
    const base = {
      clienteId, telefone: conversa.telefone, texto: lido.texto, direcao: 'SAIDA', origem: 'EQUIPE',
      botId: canal.botId, canal: canal.provedor, autorUsuarioId: req.usuario.id, autorNome: usuario?.nome || null,
      // Equipe assumiu: bot quieto por algumas horas (ou até retomar) e conversa lida.
      dadosConversa: { ...regras.pausaAoResponder(conversa), naoLidas: 0 },
    };

    let registro;
    if (!regras.envioRealLigado(canal.provedor)) {
      console.log(`[conversas:SIMULADO] ${canal.provedor} -> final ${conversa.telefoneEnvio.slice(-4)} (${lido.texto.length} caracteres)`);
      registro = await conversas.registrarMensagem({ ...base, status: 'SIMULADA' });
    } else if (canal.provedor === 'META_CLOUD') {
      const { canalWhatsappDoTenant } = require('../services/whatsappDoTenant');
      const c = await canalWhatsappDoTenant(clienteId);
      const envio = c.ok
        ? await c.adapter.enviarTexto({ para: conversa.telefoneEnvio, texto: lido.texto })
        : { ok: false, erro: 'Credencial do WhatsApp oficial indisponível.' };
      registro = await conversas.registrarMensagem({
        ...base, status: regras.statusDoEnvio(envio), erro: envio?.ok ? null : envio?.erro, idExterno: envio?.idMensagem,
      });
    } else {
      // QR Code: o socket vive no worker. Grava PENDENTE e o worker envia e
      // atualiza o status (services/mensagemTenant.js).
      registro = await conversas.registrarMensagem({ ...base, status: 'PENDENTE' });
      const { enfileirarMensagemTenant } = require('../filas');
      await enfileirarMensagemTenant({
        clienteId, para: conversa.telefoneEnvio, texto: lido.texto, tipo: 'conversa', mensagemConversaId: registro.mensagem.id,
      }).catch(async (e) => {
        console.error('[conversas] falha ao enfileirar', e?.message);
        await conversas.atualizarStatusMensagem(registro.mensagem.id, { status: 'FALHOU', erro: 'Fila indisponível.' }).catch(() => {});
        registro.mensagem.status = 'FALHOU';
      });
    }

    if (!registro) return res.status(422).json({ erro: 'Telefone da conversa inválido.' });
    const [resumo] = await comNomes([registro.conversa]);
    res.status(201).json({ mensagem: registro.mensagem, conversa: resumo });
  } catch (e) {
    erro500(res, 'responder', e);
  }
});

// ---------- bot nesta conversa ----------

async function mudarPausa(req, res, dados) {
  const conversa = await conversaDoNegocio(req);
  if (!conversa) return naoEncontrada(res);
  const atualizada = await prisma.conversa.update({ where: { id: conversa.id }, data: dados });
  const [resumo] = await comNomes([atualizada]);
  await conversas.publicar(req.usuario.clienteId, 'conversa_atualizada', { conversa: conversas.resumoConversa(atualizada) });
  return res.json({ conversa: resumo });
}

roteador.post('/:id/pausar', responder, async (req, res) => {
  try {
    const pausa = regras.lerPausa(req.body?.horas);
    if (pausa.erro) return res.status(422).json({ erro: pausa.erro, campos: ['horas'] });
    return await mudarPausa(req, res, pausa);
  } catch (e) {
    return erro500(res, 'pausar', e);
  }
});

roteador.post('/:id/retomar', responder, async (req, res) => {
  try {
    return await mudarPausa(req, res, { botPausado: false, botPausadoAte: null });
  } catch (e) {
    return erro500(res, 'retomar', e);
  }
});

module.exports = roteador;

// Chamados (admin), responder, resolver, entrar como suporte.
// Montado em /admin/suporte (src/index.js). Frente D da fase 2.
//
//   GET   /admin/suporte/resumo                     -> contadores da fila (o painel consulta pra avisar chamado novo)
//   GET   /admin/suporte/chamados?aba=ABERTO|MEUS|CLIENTE|RESOLVIDO|TODOS&busca=
//   GET   /admin/suporte/chamados/:id               -> conversa (marca como lida pela equipe)
//   PATCH /admin/suporte/chamados/:id               -> { categoria?, prioridade?, responsavelId? }
//   POST  /admin/suporte/chamados/:id/nota          -> { texto } nota interna, o cliente nao ve
//   GET   /admin/suporte/equipe                     -> quem pode ser responsavel
//   POST /admin/suporte/chamados/:id/responder   -> { texto, resolver? }  (avisa no sistema + WhatsApp)
//   POST /admin/suporte/chamados/:id/resolver
//   POST /admin/suporte/chamados/:id/reabrir
//   GET  /admin/suporte/respostas-prontas
//   PUT  /admin/suporte/respostas-prontas        -> { respostas: [{ titulo, texto }] }
//   POST /admin/suporte/sessao                   -> { clienteId, chamadoId?, motivo? } entra como suporte (so leitura, 30 min)
//
// Papeis: ver = todos; responder/resolver/respostas/entrar = dono e suporte.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { SEGREDO_JWT } = require('../middlewares/auth.middleware');
const { requerAdmin, requerPapelAdmin } = require('../middlewares/permissoes.middleware');
const { registrarAuditoria } = require('../seguranca/auditoria');
const { criarTokenSuporte, DURACAO_MIN } = require('../seguranca/sessaoSuporte');
const { definirSessao } = require('../utils/sessaoCookie');
const { criarNotificacao } = require('../utils/notificacoes');
const { avisarNoWhatsapp } = require('../assinatura/avisos');
const { obterPlano } = require('../planos/catalogo');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerAdmin);

const CATEGORIAS = ['DUVIDA', 'ERRO', 'COBRANCA', 'FISCAL', 'WHATSAPP', 'OUTRO'];
const PRIORIDADES = ['ALTA', 'NORMAL', 'BAIXA'];
const ABAS = ['ABERTO', 'MEUS', 'CLIENTE', 'RESOLVIDO', 'TODOS'];
const CHAVE_RESPOSTAS = 'respostasProntas';
// Modelos genericos pra comecar (o time edita na tela).
const RESPOSTAS_PADRAO = [
  { titulo: 'Pedir print', texto: 'Consegue me mandar um print da tela onde aparece o problema? Assim eu vejo exatamente o que está acontecendo.' },
  { titulo: 'Estou vendo', texto: 'Recebi! Já estou olhando aqui e te respondo por esta conversa em seguida.' },
  { titulo: 'Resolvido', texto: 'Pronto, está resolvido. Se acontecer de novo é só responder aqui.' },
];

function textoValido(v, min, max) {
  return typeof v === 'string' && v.trim().length >= min && v.trim().length <= max ? v.trim() : null;
}

function whereDaAba(aba, usuarioId) {
  if (aba === 'ABERTO') return { status: 'ABERTO' };
  if (aba === 'CLIENTE') return { status: 'RESPONDIDO' };
  if (aba === 'RESOLVIDO') return { status: 'RESOLVIDO' };
  if (aba === 'MEUS') return { responsavelId: usuarioId, status: { not: 'RESOLVIDO' } };
  return {};
}

const naoLido = (c) => Boolean(c.ultimaDoClienteEm && (!c.lidoSuporteEm || c.ultimaDoClienteEm > c.lidoSuporteEm));

async function nomesDaEquipe(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  const us = await prisma.usuario.findMany({ where: { id: { in: unicos } }, select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, u.nome]));
}

roteador.get('/resumo', requerPapelAdmin('suporte.ver'), async (req, res) => {
  try {
    const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [abertos, respondidos, avaliados] = await Promise.all([
      prisma.chamado.findMany({ where: { status: 'ABERTO' }, select: { id: true, ultimaDoClienteEm: true, lidoSuporteEm: true, criadoEm: true } }),
      prisma.chamado.findMany({ where: { primeiraRespostaEm: { not: null }, criadoEm: { gte: desde } }, select: { criadoEm: true, primeiraRespostaEm: true } }),
      prisma.chamado.aggregate({ where: { avaliacao: { not: null }, atualizadoEm: { gte: desde } }, _avg: { avaliacao: true }, _count: { avaliacao: true } }),
    ]);
    const minutos = respondidos.map((c) => (c.primeiraRespostaEm - c.criadoEm) / 60000).filter((m) => m >= 0);
    const maisAntigo = abertos.reduce((min, c) => {
      const t = c.ultimaDoClienteEm || c.criadoEm;
      return !min || t < min ? t : min;
    }, null);
    res.json({
      esperando: abertos.length,
      naoLidos: abertos.filter(naoLido).length,
      maisAntigoEm: maisAntigo,
      primeiraRespostaMin: minutos.length ? Math.round(minutos.reduce((a, b) => a + b, 0) / minutos.length) : null,
      satisfacao: avaliados._avg.avaliacao ? Number(avaliados._avg.avaliacao.toFixed(1)) : null,
      avaliacoes: avaliados._count.avaliacao,
    });
  } catch (e) {
    console.error('[admin/suporte/resumo]', e);
    res.status(500).json({ erro: 'Erro ao carregar o resumo do suporte.' });
  }
});

roteador.get('/equipe', requerPapelAdmin('suporte.ver'), async (req, res) => {
  try {
    const equipe = await prisma.usuario.findMany({ where: { perfil: 'ADMIN' }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } });
    res.json({ equipe });
  } catch (e) {
    console.error('[admin/suporte/equipe]', e);
    res.status(500).json({ erro: 'Erro ao carregar a equipe.' });
  }
});

roteador.get('/chamados', requerPapelAdmin('suporte.ver'), async (req, res) => {
  try {
    const aba = ABAS.includes(req.query.aba) ? req.query.aba : 'ABERTO';
    const busca = textoValido(req.query.busca, 1, 80);
    const where = whereDaAba(aba, req.usuario.id);
    if (busca) {
      const clientes = await prisma.cliente.findMany({ where: { nome: { contains: busca, mode: 'insensitive' } }, select: { id: true }, take: 50 });
      where.OR = [{ assunto: { contains: busca, mode: 'insensitive' } }, { clienteId: { in: clientes.map((c) => c.id) } }];
    }
    const [chamados, contagens] = await Promise.all([
      prisma.chamado.findMany({
        where,
        // Esperando voce: o parado ha mais tempo primeiro. Nas outras abas, o mais recente.
        orderBy: aba === 'ABERTO' ? [{ prioridade: 'asc' }, { ultimaDoClienteEm: 'asc' }] : [{ atualizadoEm: 'desc' }],
        take: 100,
        include: { mensagens: { orderBy: { criadoEm: 'desc' }, take: 1 } },
      }),
      Promise.all(ABAS.filter((a) => a !== 'TODOS').map((a) => prisma.chamado.count({ where: whereDaAba(a, req.usuario.id) }))),
    ]);
    const [clientes, nomes] = await Promise.all([
      prisma.cliente.findMany({
        where: { id: { in: [...new Set(chamados.map((c) => c.clienteId))] } },
        select: { id: true, nome: true, plano: true, statusAssinatura: true },
      }),
      nomesDaEquipe(chamados.map((c) => c.responsavelId)),
    ]);
    const porId = new Map(clientes.map((c) => [c.id, c]));
    res.json({
      chamados: chamados.map((c) => {
        const cli = porId.get(c.clienteId);
        const ultima = c.mensagens[0];
        return {
          id: c.id, assunto: c.assunto, status: c.status, canal: c.canal, criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm,
          categoria: c.categoria, prioridade: c.prioridade, avaliacao: c.avaliacao,
          responsavel: c.responsavelId ? { id: c.responsavelId, nome: nomes.get(c.responsavelId) || 'Equipe' } : null,
          ultimaDoClienteEm: c.ultimaDoClienteEm, naoLido: naoLido(c),
          cliente: cli ? { id: cli.id, nome: cli.nome, planoNome: obterPlano(cli.plano).nome, statusAssinatura: cli.statusAssinatura } : null,
          ultimaMensagem: ultima ? { autor: ultima.autor, texto: ultima.texto.slice(0, 160), criadoEm: ultima.criadoEm } : null,
        };
      }),
      contagem: Object.fromEntries(ABAS.filter((a) => a !== 'TODOS').map((a, k) => [a, contagens[k]])),
    });
  } catch (e) {
    console.error('[admin/suporte/chamados]', e);
    res.status(500).json({ erro: 'Erro ao carregar os chamados.' });
  }
});

async function carregarChamadoCompleto(id) {
  const chamado = await prisma.chamado.findUnique({ where: { id }, include: { mensagens: { orderBy: { criadoEm: 'asc' } } } });
  if (!chamado) return null;
  const [cliente, usuario] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: chamado.clienteId }, select: { id: true, nome: true, telefone: true, email: true, plano: true, statusAssinatura: true, trialAte: true } }),
    chamado.usuarioId ? prisma.usuario.findUnique({ where: { id: chamado.usuarioId }, select: { nome: true } }) : null,
  ]);
  const [responsavel, anteriores] = await Promise.all([
    chamado.responsavelId ? prisma.usuario.findUnique({ where: { id: chamado.responsavelId }, select: { id: true, nome: true } }) : null,
    prisma.chamado.findMany({
      where: { clienteId: chamado.clienteId, NOT: { id: chamado.id } },
      orderBy: { criadoEm: 'desc' }, take: 5,
      select: { id: true, assunto: true, status: true, criadoEm: true, avaliacao: true },
    }),
  ]);
  return {
    id: chamado.id, assunto: chamado.assunto, status: chamado.status, canal: chamado.canal, criadoEm: chamado.criadoEm, atualizadoEm: chamado.atualizadoEm,
    categoria: chamado.categoria, prioridade: chamado.prioridade, responsavel,
    primeiraRespostaEm: chamado.primeiraRespostaEm, ultimaDoClienteEm: chamado.ultimaDoClienteEm,
    avaliacao: chamado.avaliacao, avaliacaoComentario: chamado.avaliacaoComentario,
    anteriores,
    usuarioId: chamado.usuarioId,
    abertoPor: usuario?.nome || null,
    cliente: cliente ? { ...cliente, planoNome: obterPlano(cliente.plano).nome } : null,
    mensagens: chamado.mensagens.map((m) => ({ id: m.id, autor: m.autor, autorNome: m.autorNome, texto: m.texto, criadoEm: m.criadoEm })),
  };
}

roteador.get('/chamados/:id', requerPapelAdmin('suporte.ver'), async (req, res) => {
  try {
    const existe = await prisma.chamado.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existe) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    // Abrir a conversa marca como lida pela equipe (some a bolinha da fila).
    await prisma.chamado.update({ where: { id: existe.id }, data: { lidoSuporteEm: new Date() } });
    res.json(await carregarChamadoCompleto(existe.id));
  } catch (e) {
    console.error('[admin/suporte/chamado]', e);
    res.status(500).json({ erro: 'Erro ao carregar o chamado.' });
  }
});

roteador.patch('/chamados/:id', requerPapelAdmin('suporte.responder'), async (req, res) => {
  try {
    const data = {};
    const campos = [];
    if (req.body?.categoria !== undefined) {
      if (CATEGORIAS.includes(req.body.categoria)) data.categoria = req.body.categoria; else campos.push('categoria');
    }
    if (req.body?.prioridade !== undefined) {
      if (PRIORIDADES.includes(req.body.prioridade)) data.prioridade = req.body.prioridade; else campos.push('prioridade');
    }
    if (req.body?.responsavelId !== undefined) {
      if (req.body.responsavelId === null) data.responsavelId = null;
      else {
        const u = await prisma.usuario.findFirst({ where: { id: String(req.body.responsavelId), perfil: 'ADMIN' }, select: { id: true } });
        if (u) data.responsavelId = u.id; else campos.push('responsavelId');
      }
    }
    if (campos.length) return res.status(422).json({ erro: 'Confira os campos.', campos });
    if (!Object.keys(data).length) return res.status(422).json({ erro: 'Nada pra mudar.' });
    const chamado = await prisma.chamado.findUnique({ where: { id: req.params.id }, select: { id: true, clienteId: true } });
    if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    await prisma.chamado.update({ where: { id: chamado.id }, data });
    await registrarAuditoria(req, { acao: 'CHAMADO_EDITAR', alvoTipo: 'CLIENTE', alvoId: chamado.clienteId, detalhes: { chamadoId: chamado.id, ...data } });
    res.json(await carregarChamadoCompleto(chamado.id));
  } catch (e) {
    console.error('[admin/suporte/editar]', e);
    res.status(500).json({ erro: 'Erro ao atualizar o chamado.' });
  }
});

roteador.post('/chamados/:id/nota', requerPapelAdmin('suporte.responder'), async (req, res) => {
  try {
    const texto = textoValido(req.body?.texto, 1, 4000);
    if (!texto) return res.status(422).json({ erro: 'Escreva a nota.', campos: ['texto'] });
    const chamado = await prisma.chamado.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    // Nota interna nao muda o status nem avisa o cliente.
    await prisma.chamadoMensagem.create({ data: { chamadoId: chamado.id, autor: 'INTERNO', autorNome: req.usuario.nome || 'Equipe', texto } });
    res.status(201).json(await carregarChamadoCompleto(chamado.id));
  } catch (e) {
    console.error('[admin/suporte/nota]', e);
    res.status(500).json({ erro: 'Erro ao salvar a nota.' });
  }
});

roteador.post('/chamados/:id/responder', requerPapelAdmin('suporte.responder'), async (req, res) => {
  try {
    const texto = textoValido(req.body?.texto, 1, 4000);
    if (!texto) return res.status(422).json({ erro: 'Escreva a resposta.', campos: ['texto'] });
    const resolver = req.body?.resolver === true;
    const chamado = await prisma.chamado.findUnique({ where: { id: req.params.id }, select: { id: true, clienteId: true, usuarioId: true, assunto: true, primeiraRespostaEm: true, responsavelId: true } });
    if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });

    await prisma.$transaction([
      prisma.chamadoMensagem.create({ data: { chamadoId: chamado.id, autor: 'SUPORTE', autorNome: req.usuario.nome || 'Suporte Sellergy', texto } }),
      prisma.chamado.update({
        where: { id: chamado.id },
        data: {
          status: resolver ? 'RESOLVIDO' : 'RESPONDIDO',
          lidoSuporteEm: new Date(),
          ...(chamado.primeiraRespostaEm ? {} : { primeiraRespostaEm: new Date() }),
          // Quem responde primeiro vira o responsavel, se ninguem pegou.
          ...(chamado.responsavelId ? {} : { responsavelId: req.usuario.id }),
        },
      }),
    ]);

    // Aviso pro cliente: no sistema (abre a conversa no botao de ajuda) e no
    // WhatsApp do Sellergy. Best-effort: a resposta ja esta salva.
    const titulo = 'O suporte respondeu seu chamado';
    const resumo = texto.length > 180 ? `${texto.slice(0, 177)}...` : texto;
    await criarNotificacao(prisma, {
      clienteId: chamado.clienteId,
      usuarioId: chamado.usuarioId || null,
      tipo: 'GENERICA',
      titulo,
      mensagem: `${chamado.assunto}: ${resumo}`,
      link: `/app/dashboard?ajuda=${chamado.id}`,
      dados: { chamadoId: chamado.id },
    }).catch((e) => console.error('[admin/suporte] notificacao', e?.message));
    const whatsapp = await avisarNoWhatsapp(chamado.clienteId, `*${titulo}*\n${chamado.assunto}\n\n${resumo}\n\nVeja a conversa no botão Ajuda do Sellergy.`)
      .catch(() => ({ ok: false }));

    await registrarAuditoria(req, {
      acao: resolver ? 'CHAMADO_RESPONDER_RESOLVER' : 'CHAMADO_RESPONDER',
      alvoTipo: 'CLIENTE', alvoId: chamado.clienteId, detalhes: { chamadoId: chamado.id, assunto: chamado.assunto },
    });
    res.status(201).json({ chamado: await carregarChamadoCompleto(chamado.id), whatsapp: whatsapp?.ok ? 'enviado' : (whatsapp?.motivo || 'nao_enviado') });
  } catch (e) {
    console.error('[admin/suporte/responder]', e);
    res.status(500).json({ erro: 'Erro ao responder o chamado.' });
  }
});

roteador.post('/chamados/:id/:acao(resolver|reabrir)', requerPapelAdmin('suporte.responder'), async (req, res) => {
  try {
    const chamado = await prisma.chamado.findUnique({ where: { id: req.params.id }, select: { id: true, clienteId: true, assunto: true } });
    if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    const resolver = req.params.acao === 'resolver';
    await prisma.chamado.update({ where: { id: chamado.id }, data: { status: resolver ? 'RESOLVIDO' : 'ABERTO' } });
    await registrarAuditoria(req, {
      acao: resolver ? 'CHAMADO_RESOLVER' : 'CHAMADO_REABRIR',
      alvoTipo: 'CLIENTE', alvoId: chamado.clienteId, detalhes: { chamadoId: chamado.id, assunto: chamado.assunto },
    });
    res.json(await carregarChamadoCompleto(chamado.id));
  } catch (e) {
    console.error('[admin/suporte/status]', e);
    res.status(500).json({ erro: 'Erro ao atualizar o chamado.' });
  }
});

// ---------- Respostas prontas ----------

roteador.get('/respostas-prontas', requerPapelAdmin('suporte.ver'), async (req, res) => {
  try {
    const linha = await prisma.configPlataforma.findUnique({ where: { chave: CHAVE_RESPOSTAS } });
    res.json({ respostas: Array.isArray(linha?.valor) ? linha.valor : RESPOSTAS_PADRAO });
  } catch (e) {
    console.error('[admin/suporte/respostas]', e);
    res.status(500).json({ erro: 'Erro ao carregar as respostas prontas.' });
  }
});

roteador.put('/respostas-prontas', requerPapelAdmin('suporte.responder'), async (req, res) => {
  try {
    const lista = req.body?.respostas;
    if (!Array.isArray(lista) || lista.length > 30) return res.status(422).json({ erro: 'Mande até 30 respostas.', campos: ['respostas'] });
    const campos = [];
    const respostas = lista.map((r, i) => {
      const titulo = textoValido(r?.titulo, 2, 40);
      const texto = textoValido(r?.texto, 2, 1000);
      if (!titulo) campos.push(`respostas.${i}.titulo`);
      if (!texto) campos.push(`respostas.${i}.texto`);
      return { titulo, texto };
    });
    if (campos.length) return res.status(422).json({ erro: 'Cada resposta precisa de um nome curto e do texto.', campos });
    await prisma.configPlataforma.upsert({
      where: { chave: CHAVE_RESPOSTAS }, create: { chave: CHAVE_RESPOSTAS, valor: respostas }, update: { valor: respostas },
    });
    await registrarAuditoria(req, { acao: 'SUPORTE_RESPOSTAS_PRONTAS', alvoTipo: 'PLATAFORMA', detalhes: { quantidade: respostas.length } });
    res.json({ respostas });
  } catch (e) {
    console.error('[admin/suporte/respostas/salvar]', e);
    res.status(500).json({ erro: 'Erro ao salvar as respostas prontas.' });
  }
});

// ---------- Entrar como suporte ----------
// Troca o cookie de sessao do admin por uma sessao SO LEITURA de 30 min no
// negocio. Ao encerrar, o admin entra de novo no painel. Desenho e motivos
// em seguranca/sessaoSuporte.js.
roteador.post('/sessao', requerPapelAdmin('suporte.entrar'), async (req, res) => {
  try {
    const clienteId = textoValido(req.body?.clienteId, 1, 80);
    if (!clienteId) return res.status(422).json({ erro: 'Escolha o negócio.', campos: ['clienteId'] });
    const motivo = textoValido(req.body?.motivo, 1, 300);
    const chamadoId = textoValido(req.body?.chamadoId, 1, 80);
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true, nome: true } });
    if (!cliente) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    // Vê o sistema como o dono do negocio (ou, sem dono, como um administrador).
    const alvo = await prisma.usuario.findFirst({ where: { clienteId, perfil: 'CLIENT' }, orderBy: { criadoEm: 'asc' }, select: { id: true, perfil: true, clienteId: true } })
      || await prisma.usuario.findFirst({ where: { clienteId, perfil: 'ADMINISTRADOR' }, orderBy: { criadoEm: 'asc' }, select: { id: true, perfil: true, clienteId: true } });
    if (!alvo) return res.status(409).json({ erro: 'Esse negócio ainda não tem um usuário dono para abrir a sessão.' });

    const { token, sessaoId, expiraEm } = criarTokenSuporte({
      segredo: SEGREDO_JWT,
      usuarioAlvo: alvo,
      admin: { id: req.usuario.id, nome: req.usuario.nome },
      clienteNome: cliente.nome,
    });
    await registrarAuditoria(req, {
      acao: 'SUPORTE_ENTRAR', alvoTipo: 'CLIENTE', alvoId: cliente.id,
      detalhes: { sessaoId, chamadoId, motivo, expiraEm: expiraEm.toISOString(), duracaoMin: DURACAO_MIN },
    });
    const csrfToken = definirSessao(res, token);
    res.status(201).json({ csrfToken, expiraEm, redirecionar: '/app/dashboard', clienteNome: cliente.nome });
  } catch (e) {
    console.error('[admin/suporte/sessao]', e);
    res.status(500).json({ erro: 'Erro ao abrir a sessão de suporte.' });
  }
});

module.exports = roteador;

// Chamados (admin), responder, resolver, entrar como suporte.
// Montado em /admin/suporte (src/index.js). Frente D da fase 2.
//
//   GET  /admin/suporte/chamados?status=ABERTO|RESPONDIDO|RESOLVIDO|TODOS&busca=
//   GET  /admin/suporte/chamados/:id
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

const STATUS = ['ABERTO', 'RESPONDIDO', 'RESOLVIDO'];
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

roteador.get('/chamados', requerPapelAdmin('suporte.ver'), async (req, res) => {
  try {
    const status = STATUS.includes(req.query.status) ? req.query.status : null;
    const busca = textoValido(req.query.busca, 1, 80);
    const where = {};
    if (status) where.status = status;
    else if (req.query.status !== 'TODOS') where.status = { in: ['ABERTO', 'RESPONDIDO'] };
    if (busca) where.assunto = { contains: busca, mode: 'insensitive' };
    const [chamados, contagem] = await Promise.all([
      prisma.chamado.findMany({
        where,
        orderBy: [{ atualizadoEm: 'desc' }],
        take: 100,
        include: { mensagens: { orderBy: { criadoEm: 'desc' }, take: 1 } },
      }),
      prisma.chamado.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const clientes = await prisma.cliente.findMany({
      where: { id: { in: [...new Set(chamados.map((c) => c.clienteId))] } },
      select: { id: true, nome: true, plano: true, statusAssinatura: true },
    });
    const porId = new Map(clientes.map((c) => [c.id, c]));
    res.json({
      chamados: chamados.map((c) => {
        const cli = porId.get(c.clienteId);
        const ultima = c.mensagens[0];
        return {
          id: c.id, assunto: c.assunto, status: c.status, canal: c.canal, criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm,
          cliente: cli ? { id: cli.id, nome: cli.nome, planoNome: obterPlano(cli.plano).nome, statusAssinatura: cli.statusAssinatura } : null,
          ultimaMensagem: ultima ? { autor: ultima.autor, texto: ultima.texto.slice(0, 160), criadoEm: ultima.criadoEm } : null,
        };
      }),
      contagem: Object.fromEntries(contagem.map((g) => [g.status, g._count._all])),
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
  return {
    id: chamado.id, assunto: chamado.assunto, status: chamado.status, canal: chamado.canal, criadoEm: chamado.criadoEm, atualizadoEm: chamado.atualizadoEm,
    usuarioId: chamado.usuarioId,
    abertoPor: usuario?.nome || null,
    cliente: cliente ? { ...cliente, planoNome: obterPlano(cliente.plano).nome } : null,
    mensagens: chamado.mensagens.map((m) => ({ id: m.id, autor: m.autor, autorNome: m.autorNome, texto: m.texto, criadoEm: m.criadoEm })),
  };
}

roteador.get('/chamados/:id', requerPapelAdmin('suporte.ver'), async (req, res) => {
  try {
    const chamado = await carregarChamadoCompleto(req.params.id);
    if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    res.json(chamado);
  } catch (e) {
    console.error('[admin/suporte/chamado]', e);
    res.status(500).json({ erro: 'Erro ao carregar o chamado.' });
  }
});

roteador.post('/chamados/:id/responder', requerPapelAdmin('suporte.responder'), async (req, res) => {
  try {
    const texto = textoValido(req.body?.texto, 1, 4000);
    if (!texto) return res.status(422).json({ erro: 'Escreva a resposta.', campos: ['texto'] });
    const resolver = req.body?.resolver === true;
    const chamado = await prisma.chamado.findUnique({ where: { id: req.params.id }, select: { id: true, clienteId: true, usuarioId: true, assunto: true } });
    if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });

    await prisma.$transaction([
      prisma.chamadoMensagem.create({ data: { chamadoId: chamado.id, autor: 'SUPORTE', autorNome: req.usuario.nome || 'Suporte Sellergy', texto } }),
      prisma.chamado.update({ where: { id: chamado.id }, data: { status: resolver ? 'RESOLVIDO' : 'RESPONDIDO' } }),
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

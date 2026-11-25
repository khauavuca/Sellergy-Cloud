// Chamados de suporte do lado do cliente (botao de ajuda).
// Montado em /suporte (src/index.js). Frente D da fase 2.
//
//   GET  /suporte/chamados                 -> chamados do negocio (mais recentes primeiro)
//   GET  /suporte/chamados/:id             -> conversa
//   POST /suporte/chamados                 -> { assunto, texto, categoria? } abre chamado
//   POST /suporte/chamados/:id/avaliar     -> { nota 1-5, comentario? } depois de resolvido
//   POST /suporte/chamados/:id/fotos       -> multipart { imagem, texto? } foto temporaria
//   GET  /suporte/chamados/:id/fotos/:msg  -> a foto (some quando o chamado e resolvido)
//   POST /suporte/chamados/:id/mensagens   -> { texto } responde (reabre se estava resolvido)
//   POST /suporte/sessao/encerrar          -> sai da sessao de suporte (so leitura) do admin
//
// Conta suspensa ou teste vencido continua podendo pedir ajuda (nao passa
// pelo requerModuloLiberado de proposito). Na sessao de suporte do admin as
// escritas daqui sao barradas pelo auth.middleware (so leitura).

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerTenant, ehAdmin } = require('../middlewares/permissoes.middleware');
const { limparSessao } = require('../utils/sessaoCookie');
const { registrarAuditoria } = require('../seguranca/auditoria');
const { aceitarUmaImagem } = require('../middlewares/upload.middleware');
const { uploadSeguro } = require('../seguranca/uploadSeguro');
const anexos = require('../suporte/anexos');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);

const MAX_ABERTOS = 5;
const CATEGORIAS = ['DUVIDA', 'ERRO', 'COBRANCA', 'FISCAL', 'WHATSAPP', 'OUTRO'];
// Nota interna e so da equipe: nunca sai por aqui.
const VISIVEL = { autor: { not: 'INTERNO' } };

function textoValido(v, min, max) {
  return typeof v === 'string' && v.trim().length >= min && v.trim().length <= max ? v.trim() : null;
}

// Encerrar a sessao de suporte vem antes do requerTenant (o token e do tenant,
// mas a rota so faz sentido com o claim de suporte).
roteador.post('/sessao/encerrar', async (req, res) => {
  const suporte = req.usuario?.suporte;
  if (!suporte) return res.status(409).json({ erro: 'Não há sessão de suporte aberta.' });
  await registrarAuditoria(req, {
    acao: 'SUPORTE_SAIR', alvoTipo: 'CLIENTE', alvoId: req.usuario.clienteId,
    detalhes: { sessaoId: suporte.sessaoId, clienteNome: suporte.clienteNome },
  });
  limparSessao(res);
  res.json({ ok: true, redirecionar: '/admin/login' });
});

roteador.use(requerTenant);
roteador.use((req, res, next) => {
  // Chamado e do negocio: o admin usa /admin/suporte.
  if (ehAdmin(req.usuario) || !req.usuario.clienteId) return res.status(403).json({ erro: 'Use o painel de suporte do admin.' });
  return next();
});

function formatarChamado(c) {
  const ultima = c.mensagens?.[c.mensagens.length - 1] || null;
  return {
    id: c.id,
    assunto: c.assunto,
    status: c.status,
    categoria: c.categoria,
    avaliacao: c.avaliacao ?? null,
    criadoEm: c.criadoEm,
    atualizadoEm: c.atualizadoEm,
    ultimaMensagem: ultima ? { autor: ultima.autor, texto: ultima.texto.slice(0, 160), criadoEm: ultima.criadoEm } : null,
  };
}

roteador.get('/chamados', async (req, res) => {
  try {
    const chamados = await prisma.chamado.findMany({
      where: { clienteId: req.usuario.clienteId },
      orderBy: { atualizadoEm: 'desc' },
      take: 30,
      include: { mensagens: { where: VISIVEL, orderBy: { criadoEm: 'desc' }, take: 1 } },
    });
    res.json(chamados.map((c) => formatarChamado({ ...c, mensagens: c.mensagens.reverse() })));
  } catch (e) {
    console.error('[suporte/chamados]', e);
    res.status(500).json({ erro: 'Erro ao carregar os chamados.' });
  }
});

roteador.get('/chamados/:id', async (req, res) => {
  try {
    const chamado = await prisma.chamado.findFirst({
      where: { id: req.params.id, clienteId: req.usuario.clienteId },
      include: { mensagens: { where: VISIVEL, orderBy: { criadoEm: 'asc' } } },
    });
    if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    res.json({
      ...formatarChamado(chamado),
      resolvidoEm: chamado.resolvidoEm, conversaApagadaEm: chamado.conversaApagadaEm, diasGuarda: anexos.DIAS_GUARDA_CONVERSA,
      mensagens: chamado.mensagens.map((m) => anexos.formatarMensagem(m, `/suporte/chamados/${chamado.id}/fotos`)),
    });
  } catch (e) {
    console.error('[suporte/chamado]', e);
    res.status(500).json({ erro: 'Erro ao carregar o chamado.' });
  }
});

async function nomeDoUsuario(id) {
  const u = await prisma.usuario.findUnique({ where: { id }, select: { nome: true } });
  return u?.nome || 'Cliente';
}

roteador.post('/chamados', async (req, res) => {
  try {
    const assunto = textoValido(req.body?.assunto, 3, 120);
    const texto = textoValido(req.body?.texto, 3, 4000);
    const campos = [];
    if (!assunto) campos.push('assunto');
    if (!texto) campos.push('texto');
    if (campos.length) return res.status(422).json({ erro: 'Conte o assunto (3 a 120 letras) e o que aconteceu.', campos });

    const abertos = await prisma.chamado.count({ where: { clienteId: req.usuario.clienteId, status: { not: 'RESOLVIDO' } } });
    if (abertos >= MAX_ABERTOS) {
      return res.status(429).json({ erro: `Você já tem ${abertos} chamados em andamento. Responda em um deles que a gente continua por lá.` });
    }
    const categoria = CATEGORIAS.includes(req.body?.categoria) ? req.body.categoria : 'DUVIDA';
    const autorNome = await nomeDoUsuario(req.usuario.id);
    const chamado = await prisma.chamado.create({
      data: {
        clienteId: req.usuario.clienteId,
        usuarioId: req.usuario.id,
        assunto,
        categoria,
        // Cobranca e erro entram como prioridade alta: travam o uso.
        prioridade: ['ERRO', 'COBRANCA', 'FISCAL'].includes(categoria) ? 'ALTA' : 'NORMAL',
        ultimaDoClienteEm: new Date(),
        canal: 'APP',
        mensagens: { create: { autor: 'CLIENTE', autorNome, texto } },
      },
      include: { mensagens: true },
    });
    res.status(201).json(formatarChamado(chamado));
  } catch (e) {
    console.error('[suporte/abrir]', e);
    res.status(500).json({ erro: 'Erro ao abrir o chamado.' });
  }
});

roteador.post('/chamados/:id/mensagens', async (req, res) => {
  try {
    const texto = textoValido(req.body?.texto, 1, 4000);
    if (!texto) return res.status(422).json({ erro: 'Escreva a mensagem.', campos: ['texto'] });
    const chamado = await prisma.chamado.findFirst({ where: { id: req.params.id, clienteId: req.usuario.clienteId }, select: { id: true, status: true, conversaApagadaEm: true } });
    if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    if (chamado.conversaApagadaEm) return res.status(409).json({ erro: 'Essa conversa já foi encerrada. Abra um chamado novo.' });
    if (chamado.status === 'RESOLVIDO') await anexos.aoReabrir(chamado.id);
    const autorNome = await nomeDoUsuario(req.usuario.id);
    const [mensagem] = await prisma.$transaction([
      prisma.chamadoMensagem.create({ data: { chamadoId: chamado.id, autor: 'CLIENTE', autorNome, texto } }),
      prisma.chamado.update({ where: { id: chamado.id }, data: { status: 'ABERTO', ultimaDoClienteEm: new Date() } }),
    ]);
    res.status(201).json({ id: mensagem.id, autor: mensagem.autor, autorNome: mensagem.autorNome, texto: mensagem.texto, criadoEm: mensagem.criadoEm });
  } catch (e) {
    console.error('[suporte/mensagem]', e);
    res.status(500).json({ erro: 'Erro ao enviar a mensagem.' });
  }
});

roteador.post('/chamados/:id/fotos', aceitarUmaImagem('imagem'), uploadSeguro('imagem'), async (req, res) => {
  try {
    if (!req.file) return res.status(422).json({ erro: 'Escolha uma foto.', campos: ['imagem'] });
    const texto = textoValido(req.body?.texto, 1, 4000) || '';
    const chamado = await prisma.chamado.findFirst({ where: { id: req.params.id, clienteId: req.usuario.clienteId }, select: { id: true, clienteId: true, status: true, conversaApagadaEm: true } });
    if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    if (chamado.conversaApagadaEm) return res.status(409).json({ erro: 'Essa conversa já foi encerrada. Abra um chamado novo.' });
    if (chamado.status === 'RESOLVIDO') await anexos.aoReabrir(chamado.id);
    const autorNome = await nomeDoUsuario(req.usuario.id);
    const mensagem = await anexos.criarMensagemComFoto({ chamado, arquivo: req.file, autor: 'CLIENTE', autorNome, texto });
    await prisma.chamado.update({ where: { id: chamado.id }, data: { status: 'ABERTO', ultimaDoClienteEm: new Date() } });
    res.status(201).json(anexos.formatarMensagem(mensagem, `/suporte/chamados/${chamado.id}/fotos`));
  } catch (e) {
    console.error('[suporte/foto]', e);
    res.status(500).json({ erro: 'Erro ao enviar a foto.' });
  }
});

roteador.get('/chamados/:id/fotos/:mensagemId', async (req, res) => {
  const mensagem = await prisma.chamadoMensagem.findFirst({
    where: { id: req.params.mensagemId, chamadoId: req.params.id, autor: { not: 'INTERNO' }, chamado: { clienteId: req.usuario.clienteId } },
    select: { anexoChave: true, anexoTipo: true },
  }).catch(() => null);
  return anexos.enviarFoto(res, mensagem);
});

roteador.post('/chamados/:id/avaliar', async (req, res) => {
  try {
    const nota = Number(req.body?.nota);
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) return res.status(422).json({ erro: 'Escolha uma nota de 1 a 5.', campos: ['nota'] });
    const comentario = textoValido(req.body?.comentario, 1, 500);
    const chamado = await prisma.chamado.findFirst({ where: { id: req.params.id, clienteId: req.usuario.clienteId }, select: { id: true, status: true } });
    if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    if (chamado.status !== 'RESOLVIDO') return res.status(409).json({ erro: 'Dá pra avaliar depois que o chamado for resolvido.' });
    await prisma.chamado.update({ where: { id: chamado.id }, data: { avaliacao: nota, avaliacaoComentario: comentario } });
    res.json({ ok: true, avaliacao: nota });
  } catch (e) {
    console.error('[suporte/avaliar]', e);
    res.status(500).json({ erro: 'Erro ao salvar a avaliação.' });
  }
});

module.exports = roteador;

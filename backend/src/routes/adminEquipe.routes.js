// Equipe Sellergy (papeis) e auditoria.
// Montado em /admin/equipe (src/index.js). Frente D da fase 2.
//
//   GET  /admin/equipe                    -> pessoas da equipe + matriz de papeis
//   POST /admin/equipe                    -> { nome, email, papel, exige2fa } cria acesso (senha provisoria, mostrada 1 vez)
//   PUT  /admin/equipe/:id                -> { papel?, exige2fa? }
//   POST /admin/equipe/:id/desativar      -> corta o acesso (login e sessoes abertas)
//   POST /admin/equipe/:id/reativar       -> { papel }
//   POST /admin/equipe/:id/nova-senha     -> senha provisoria nova (troca obrigatoria no 1o login)
//   GET  /admin/equipe/auditoria          -> ?pagina&porPagina&acao&usuarioId&alvoTipo&alvoId&de&ate&busca
//   GET  /admin/equipe/auditoria/filtros  -> acoes e pessoas que ja aparecem no log
//
// Tudo so pro DONO (matriz: "Precos, regua e equipe"). A auditoria nao tem
// rota de alterar nem apagar.

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerAdmin, requerPapelAdmin } = require('../middlewares/permissoes.middleware');
const { registrarAuditoria } = require('../seguranca/auditoria');
const { PAPEIS, MATRIZ, DONO, DESATIVADO, papelDe, papelParaBanco } = require('../seguranca/papeis');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerAdmin);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function senhaProvisoria() {
  // 14 caracteres sem ambiguos (0/O, 1/l), com numero garantido.
  const alfabeto = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(14);
  let s = '';
  for (const b of bytes) s += alfabeto[b % alfabeto.length];
  return `${s.slice(0, 12)}${2 + (bytes[0] % 8)}${alfabeto[bytes[1] % 26]}`;
}

function formatarPessoa(u, eu) {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    papel: papelDe(u.papelAdmin),
    ativo: papelDe(u.papelAdmin) !== DESATIVADO,
    totpAtivo: u.totpAtivo === true,
    exige2fa: u.permissoes?.exige2fa === true,
    deveTrocarSenha: u.deveTrocarSenha === true,
    criadoEm: u.criadoEm,
    ultimaAcao: u.ultimaAcao || null,
    euMesmo: u.id === eu,
  };
}

const CAMPOS_PESSOA = { id: true, nome: true, email: true, papelAdmin: true, totpAtivo: true, permissoes: true, deveTrocarSenha: true, criadoEm: true };

async function donosAtivos(excetoId) {
  return prisma.usuario.count({ where: { perfil: 'ADMIN', papelAdmin: null, ...(excetoId ? { id: { not: excetoId } } : {}) } });
}

async function carregarPessoa(req, res) {
  const pessoa = await prisma.usuario.findFirst({ where: { id: req.params.id, perfil: 'ADMIN' }, select: CAMPOS_PESSOA });
  if (!pessoa) res.status(404).json({ erro: 'Pessoa da equipe não encontrada.' });
  return pessoa;
}

roteador.get('/', requerPapelAdmin('equipe.gerenciar'), async (req, res) => {
  try {
    const pessoas = await prisma.usuario.findMany({ where: { perfil: 'ADMIN' }, select: CAMPOS_PESSOA, orderBy: { criadoEm: 'asc' } });
    const ultimas = await prisma.auditoriaAdmin.groupBy({
      by: ['usuarioId'], where: { usuarioId: { in: pessoas.map((p) => p.id) } }, _max: { criadoEm: true },
    });
    const mapa = new Map(ultimas.map((u) => [u.usuarioId, u._max.criadoEm]));
    res.json({
      pessoas: pessoas.map((p) => formatarPessoa({ ...p, ultimaAcao: mapa.get(p.id) }, req.usuario.id)),
      papeis: PAPEIS,
      matriz: MATRIZ,
      admin2faObrigatorioGeral: process.env.ADMIN_2FA_OBRIGATORIO === 'true',
    });
  } catch (e) {
    console.error('[admin/equipe/listar]', e);
    res.status(500).json({ erro: 'Erro ao listar a equipe.' });
  }
});

roteador.post('/', requerPapelAdmin('equipe.gerenciar'), async (req, res) => {
  try {
    const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const papel = req.body?.papel;
    const exige2fa = req.body?.exige2fa !== false;
    const campos = [];
    if (nome.length < 2 || nome.length > 120) campos.push('nome');
    if (!EMAIL_RE.test(email) || email.length > 160) campos.push('email');
    if (!PAPEIS.includes(papel)) campos.push('papel');
    if (campos.length) return res.status(422).json({ erro: 'Confira nome, e-mail e papel.', campos });

    const existente = await prisma.usuario.findUnique({ where: { email }, select: { id: true } });
    if (existente) return res.status(409).json({ erro: 'Já existe um acesso com esse e-mail.', campos: ['email'] });

    const senha = senhaProvisoria();
    const criado = await prisma.usuario.create({
      data: {
        nome, email, perfil: 'ADMIN', papelAdmin: papelParaBanco(papel),
        senha: await bcrypt.hash(senha, 12), deveTrocarSenha: true,
        permissoes: { exige2fa },
      },
      select: CAMPOS_PESSOA,
    });
    await registrarAuditoria(req, { acao: 'EQUIPE_CRIAR', alvoTipo: 'USUARIO', alvoId: criado.id, detalhes: { nome, email, papel, exige2fa } });
    // A senha provisoria so aparece nesta resposta (nao fica em log nem no banco em claro).
    res.status(201).json({ pessoa: formatarPessoa(criado, req.usuario.id), senhaProvisoria: senha });
  } catch (e) {
    console.error('[admin/equipe/criar]', e);
    res.status(500).json({ erro: 'Erro ao criar o acesso.' });
  }
});

roteador.put('/:id', requerPapelAdmin('equipe.gerenciar'), async (req, res) => {
  try {
    const pessoa = await carregarPessoa(req, res);
    if (!pessoa) return undefined;
    const { papel, exige2fa } = req.body || {};
    const data = {};
    const detalhes = {};
    if (papel !== undefined) {
      if (!PAPEIS.includes(papel)) return res.status(422).json({ erro: 'Papel inválido.', campos: ['papel'] });
      if (papelDe(pessoa.papelAdmin) === DESATIVADO) return res.status(409).json({ erro: 'Reative o acesso antes de trocar o papel.' });
      if (pessoa.id === req.usuario.id && papel !== DONO) return res.status(409).json({ erro: 'Você não pode tirar o seu próprio papel de dono.' });
      if (papelDe(pessoa.papelAdmin) === DONO && papel !== DONO && (await donosAtivos(pessoa.id)) === 0) {
        return res.status(409).json({ erro: 'A equipe precisa de pelo menos um dono ativo.' });
      }
      data.papelAdmin = papelParaBanco(papel);
      detalhes.papel = { de: papelDe(pessoa.papelAdmin), para: papel };
    }
    if (exige2fa !== undefined) {
      if (typeof exige2fa !== 'boolean') return res.status(422).json({ erro: 'exige2fa deve ser sim ou não.', campos: ['exige2fa'] });
      data.permissoes = { ...(pessoa.permissoes || {}), exige2fa };
      detalhes.exige2fa = { de: pessoa.permissoes?.exige2fa === true, para: exige2fa };
    }
    if (!Object.keys(data).length) return res.status(422).json({ erro: 'Nada para alterar.' });
    const atualizado = await prisma.usuario.update({ where: { id: pessoa.id }, data, select: CAMPOS_PESSOA });
    await registrarAuditoria(req, { acao: 'EQUIPE_EDITAR', alvoTipo: 'USUARIO', alvoId: pessoa.id, detalhes: { nome: pessoa.nome, ...detalhes } });
    res.json(formatarPessoa(atualizado, req.usuario.id));
  } catch (e) {
    console.error('[admin/equipe/editar]', e);
    res.status(500).json({ erro: 'Erro ao atualizar o acesso.' });
  }
});

roteador.post('/:id/desativar', requerPapelAdmin('equipe.gerenciar'), async (req, res) => {
  try {
    const pessoa = await carregarPessoa(req, res);
    if (!pessoa) return undefined;
    if (pessoa.id === req.usuario.id) return res.status(409).json({ erro: 'Você não pode desativar o seu próprio acesso.' });
    if (papelDe(pessoa.papelAdmin) === DESATIVADO) return res.status(409).json({ erro: 'Esse acesso já está desativado.' });
    if (papelDe(pessoa.papelAdmin) === DONO && (await donosAtivos(pessoa.id)) === 0) {
      return res.status(409).json({ erro: 'A equipe precisa de pelo menos um dono ativo.' });
    }
    const atualizado = await prisma.usuario.update({ where: { id: pessoa.id }, data: { papelAdmin: DESATIVADO }, select: CAMPOS_PESSOA });
    await registrarAuditoria(req, { acao: 'EQUIPE_DESATIVAR', alvoTipo: 'USUARIO', alvoId: pessoa.id, detalhes: { nome: pessoa.nome, papelAnterior: papelDe(pessoa.papelAdmin) } });
    res.json(formatarPessoa(atualizado, req.usuario.id));
  } catch (e) {
    console.error('[admin/equipe/desativar]', e);
    res.status(500).json({ erro: 'Erro ao desativar o acesso.' });
  }
});

roteador.post('/:id/reativar', requerPapelAdmin('equipe.gerenciar'), async (req, res) => {
  try {
    const pessoa = await carregarPessoa(req, res);
    if (!pessoa) return undefined;
    const papel = req.body?.papel;
    if (!PAPEIS.includes(papel)) return res.status(422).json({ erro: 'Escolha o papel.', campos: ['papel'] });
    if (papelDe(pessoa.papelAdmin) !== DESATIVADO) return res.status(409).json({ erro: 'Esse acesso já está ativo.' });
    const atualizado = await prisma.usuario.update({ where: { id: pessoa.id }, data: { papelAdmin: papelParaBanco(papel) }, select: CAMPOS_PESSOA });
    await registrarAuditoria(req, { acao: 'EQUIPE_REATIVAR', alvoTipo: 'USUARIO', alvoId: pessoa.id, detalhes: { nome: pessoa.nome, papel } });
    res.json(formatarPessoa(atualizado, req.usuario.id));
  } catch (e) {
    console.error('[admin/equipe/reativar]', e);
    res.status(500).json({ erro: 'Erro ao reativar o acesso.' });
  }
});

roteador.post('/:id/nova-senha', requerPapelAdmin('equipe.gerenciar'), async (req, res) => {
  try {
    const pessoa = await carregarPessoa(req, res);
    if (!pessoa) return undefined;
    if (pessoa.id === req.usuario.id) return res.status(409).json({ erro: 'Troque a sua senha pelo seu perfil.' });
    const senha = senhaProvisoria();
    await prisma.usuario.update({ where: { id: pessoa.id }, data: { senha: await bcrypt.hash(senha, 12), deveTrocarSenha: true } });
    await registrarAuditoria(req, { acao: 'EQUIPE_NOVA_SENHA', alvoTipo: 'USUARIO', alvoId: pessoa.id, detalhes: { nome: pessoa.nome } });
    res.json({ senhaProvisoria: senha });
  } catch (e) {
    console.error('[admin/equipe/nova-senha]', e);
    res.status(500).json({ erro: 'Erro ao gerar a senha.' });
  }
});

// ---------- Auditoria ----------

function dataDoFiltro(valor, fimDoDia = false) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const d = new Date(`${valor}T${fimDoDia ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function texto(v, max = 120) {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

roteador.get('/auditoria', requerPapelAdmin('auditoria.ver'), async (req, res) => {
  try {
    const pagina = Math.max(1, Math.min(10_000, Number.parseInt(req.query.pagina, 10) || 1));
    const porPagina = Math.max(5, Math.min(100, Number.parseInt(req.query.porPagina, 10) || 25));
    const where = {};
    const acao = texto(req.query.acao, 80);
    const usuarioId = texto(req.query.usuarioId, 80);
    const alvoTipo = texto(req.query.alvoTipo, 40);
    const alvoId = texto(req.query.alvoId, 80);
    const busca = texto(req.query.busca, 80);
    const de = dataDoFiltro(req.query.de);
    const ate = dataDoFiltro(req.query.ate, true);
    if (acao) where.acao = acao;
    if (usuarioId) where.usuarioId = usuarioId;
    if (alvoTipo) where.alvoTipo = alvoTipo;
    if (alvoId) where.alvoId = alvoId;
    if (de || ate) where.criadoEm = { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) };
    if (busca) where.OR = [{ usuarioNome: { contains: busca, mode: 'insensitive' } }, { acao: { contains: busca, mode: 'insensitive' } }, { alvoId: busca }];

    const [total, itens] = await Promise.all([
      prisma.auditoriaAdmin.count({ where }),
      prisma.auditoriaAdmin.findMany({ where, orderBy: { criadoEm: 'desc' }, skip: (pagina - 1) * porPagina, take: porPagina }),
    ]);

    // Nome do cliente-alvo pra leitura humana (sem expor nada alem do nome).
    const idsClientes = [...new Set(itens.filter((i) => i.alvoTipo === 'CLIENTE' && i.alvoId).map((i) => i.alvoId))];
    const clientes = idsClientes.length
      ? await prisma.cliente.findMany({ where: { id: { in: idsClientes } }, select: { id: true, nome: true } })
      : [];
    const nomeCliente = new Map(clientes.map((c) => [c.id, c.nome]));

    res.json({
      itens: itens.map((i) => ({ ...i, alvoNome: i.alvoTipo === 'CLIENTE' ? nomeCliente.get(i.alvoId) || null : null })),
      total,
      pagina,
      porPagina,
      paginas: Math.max(1, Math.ceil(total / porPagina)),
    });
  } catch (e) {
    console.error('[admin/equipe/auditoria]', e);
    res.status(500).json({ erro: 'Erro ao carregar a auditoria.' });
  }
});

roteador.get('/auditoria/filtros', requerPapelAdmin('auditoria.ver'), async (req, res) => {
  try {
    const [acoes, pessoas] = await Promise.all([
      prisma.auditoriaAdmin.groupBy({ by: ['acao'], _count: { _all: true }, orderBy: { acao: 'asc' } }),
      prisma.auditoriaAdmin.groupBy({ by: ['usuarioId', 'usuarioNome'], _count: { _all: true }, orderBy: { usuarioNome: 'asc' } }),
    ]);
    res.json({
      acoes: acoes.map((a) => a.acao),
      pessoas: pessoas.filter((p) => p.usuarioId).map((p) => ({ id: p.usuarioId, nome: p.usuarioNome })),
    });
  } catch (e) {
    console.error('[admin/equipe/auditoria/filtros]', e);
    res.status(500).json({ erro: 'Erro ao carregar os filtros.' });
  }
});

module.exports = roteador;

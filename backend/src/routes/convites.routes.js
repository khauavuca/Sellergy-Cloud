// Convidar pessoa da equipe pelo WhatsApp (e link pra copiar).
// Montado em /convites (src/index.js). Frente C da fase 2.
//
//   GET    /convites                 -> convites abertos + vagas do plano
//   GET    /convites/especialistas   -> profissionais da agenda ainda sem login
//   POST   /convites                 -> cria e manda pelo WhatsApp do negocio
//   POST   /convites/:id/reenviar    -> token novo, mais 7 dias, manda de novo
//   DELETE /convites/:id             -> cancela (o link para de funcionar)
//
// So a dona (CLIENT) ou um ADMINISTRADOR. Regras em src/convites/regras.js.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerTenant, requerPapelPrivilegiado } = require('../middlewares/permissoes.middleware');
const { garantirDentroDoLimite, limiteDo, CAMPOS_ASSINATURA } = require('../planos/recursos');
const { situacaoAssinatura } = require('../assinatura/situacao');
const { enviarMensagemTenant } = require('../services/mensagemTenant');
const regras = require('../convites/regras');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerTenant);
roteador.use(requerPapelPrivilegiado);
roteador.use((req, res, next) => (req.usuario.clienteId ? next() : res.status(403).json({ erro: 'Entre com a conta do negócio.' })));

// Conta em modo so leitura (teste vencido / suspensa) nao convida ninguem.
roteador.use(async (req, res, next) => {
  if (req.method === 'GET') return next();
  try {
    const cliente = await prisma.cliente.findUnique({ where: { id: req.usuario.clienteId }, select: { ...CAMPOS_ASSINATURA, status: true } });
    if (!cliente || cliente.status !== 'ACTIVE') return res.status(403).json({ erro: 'Conta inativa ou suspensa.' });
    if (situacaoAssinatura(cliente).somenteLeitura) {
      return res.status(402).json({ erro: 'Sua conta está em modo somente leitura. Regularize a assinatura para convidar pessoas.', codigo: 'ASSINATURA_BLOQUEADA' });
    }
    return next();
  } catch (e) {
    console.error('[convites/assinatura]', e);
    return res.status(500).json({ erro: 'Erro ao validar a conta.' });
  }
});

const CAMPOS_CONVITE = {
  id: true, nome: true, email: true, telefone: true, perfil: true, especialistaId: true,
  expiraEm: true, aceitoEm: true, criadoEm: true,
};

function formatar(convite, agora = new Date()) {
  return { ...convite, situacao: regras.situacaoConvite(convite, agora) };
}

async function pendentesDoTenant(clienteId, excetoId = null) {
  return prisma.conviteEquipe.count({
    where: { clienteId, aceitoEm: null, expiraEm: { gt: new Date() }, ...(excetoId ? { id: { not: excetoId } } : {}) },
  });
}

async function temWhatsapp(clienteId) {
  const bot = await prisma.bot.findFirst({ where: { clienteId, identificadorCanal: { not: null } }, select: { id: true } });
  return Boolean(bot);
}

/** Manda o link pelo WhatsApp do negocio. Nunca derruba a criacao do convite. */
async function mandarConvite({ clienteId, convite, token, quemConvidou }) {
  const link = regras.linkConvite(token);
  if (!convite.telefone) return { link, whatsapp: { enviado: false, motivo: 'SEM_TELEFONE' } };
  if (!(await temWhatsapp(clienteId))) return { link, whatsapp: { enviado: false, motivo: 'SEM_WHATSAPP' } };
  try {
    const negocio = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, brandNome: true } });
    const texto = regras.textoConvite({
      nomeConvidado: convite.nome,
      nomeQuemConvidou: quemConvidou || 'A dona',
      nomeNegocio: negocio?.brandNome || negocio?.nome || 'empresa',
      link,
    });
    const r = await enviarMensagemTenant({ clienteId, para: convite.telefone, texto, tipo: 'conversa' });
    return { link, whatsapp: { enviado: r?.ok === true, motivo: r?.ok ? null : r?.motivo || 'FALHA' } };
  } catch (e) {
    console.error('[convites/whatsapp]', e?.message);
    return { link, whatsapp: { enviado: false, motivo: 'FALHA' } };
  }
}

async function nomeDoSolicitante(req) {
  const u = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } });
  return u?.nome?.split(' ')[0] || null;
}

roteador.get('/', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const [convites, usuarios, cliente] = await Promise.all([
      prisma.conviteEquipe.findMany({ where: { clienteId, aceitoEm: null }, select: CAMPOS_CONVITE, orderBy: { criadoEm: 'desc' }, take: 50 }),
      prisma.usuario.count({ where: { clienteId } }),
      prisma.cliente.findUnique({ where: { id: clienteId }, select: CAMPOS_ASSINATURA }),
    ]);
    const agora = new Date();
    const lista = convites.map((c) => formatar(c, agora));
    const pendentes = lista.filter((c) => c.situacao === 'PENDENTE').length;
    const maximo = limiteDo(cliente, 'usuarios');
    res.json({
      convites: lista,
      vagas: { usuarios, convitesPendentes: pendentes, maximo: Number.isFinite(maximo) ? maximo : null },
      whatsappConectado: await temWhatsapp(clienteId),
    });
  } catch (e) {
    console.error('[convites/listar]', e);
    res.status(500).json({ erro: 'Não foi possível carregar os convites.' });
  }
});

roteador.get('/especialistas', async (req, res) => {
  try {
    const lista = await prisma.especialista.findMany({
      where: { clienteId: req.usuario.clienteId, usuarioId: null, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
    res.json(lista);
  } catch (e) {
    console.error('[convites/especialistas]', e);
    res.status(500).json({ erro: 'Não foi possível carregar os profissionais.' });
  }
});

roteador.post('/', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const v = regras.validarConvite(req.body || {}, { perfilSolicitante: req.usuario.perfil });
    if (v.erro) return res.status(v.status || 422).json({ erro: v.erro, campos: v.campos });
    const d = v.dados;

    const jaUsuario = await prisma.usuario.findUnique({ where: { email: d.email }, select: { id: true } });
    if (jaUsuario) return res.status(409).json({ erro: 'Este e-mail já tem acesso ao Sellergy.', campos: ['email'] });
    const jaConvidado = await prisma.conviteEquipe.findFirst({
      where: { clienteId, email: d.email, aceitoEm: null, expiraEm: { gt: new Date() } }, select: { id: true },
    });
    if (jaConvidado) return res.status(409).json({ erro: 'Já existe um convite aberto pra este e-mail. Use "Reenviar".', campos: ['email'] });

    if (d.especialistaId) {
      const esp = await prisma.especialista.findFirst({ where: { id: d.especialistaId, clienteId }, select: { usuarioId: true } });
      if (!esp) return res.status(422).json({ erro: 'Profissional não encontrado.', campos: ['especialistaId'] });
      if (esp.usuarioId) return res.status(409).json({ erro: 'Este profissional já tem login.', campos: ['especialistaId'] });
    }

    // Limite do plano: usuarios atuais + convites abertos ocupam vaga.
    const [usuarios, pendentes] = await Promise.all([prisma.usuario.count({ where: { clienteId } }), pendentesDoTenant(clienteId)]);
    await garantirDentroDoLimite({ clienteId, limite: 'usuarios', usoAtual: regras.usoComConvites(usuarios, pendentes) });

    const token = regras.gerarToken();
    const convite = await prisma.conviteEquipe.create({
      data: {
        clienteId, nome: d.nome, email: d.email, telefone: d.telefone, perfil: d.perfil,
        especialistaId: d.especialistaId, token, expiraEm: regras.calcularExpiracao(), criadoPorId: req.usuario.id,
      },
      select: CAMPOS_CONVITE,
    });
    const envio = await mandarConvite({ clienteId, convite, token, quemConvidou: await nomeDoSolicitante(req) });
    return res.status(201).json({ convite: formatar(convite), ...envio });
  } catch (e) {
    if (e.codigo === 'LIMITE_DO_PLANO') {
      return res.status(403).json({ erro: e.message, codigo: e.codigo, limite: e.limite, maximo: e.maximo, planoSugerido: e.planoSugerido });
    }
    console.error('[convites/criar]', e);
    return res.status(500).json({ erro: 'Não foi possível criar o convite.' });
  }
});

roteador.post('/:id/reenviar', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const atual = await prisma.conviteEquipe.findFirst({ where: { id: req.params.id, clienteId } });
    if (!atual) return res.status(404).json({ erro: 'Convite não encontrado.' });
    if (atual.aceitoEm) return res.status(409).json({ erro: 'Este convite já foi aceito.' });
    if (req.usuario.perfil === 'ADMINISTRADOR' && atual.perfil === 'ADMINISTRADOR') {
      return res.status(403).json({ erro: 'Só a dona da conta pode convidar outro administrador.' });
    }
    // Convite vencido volta a ocupar vaga: confere o limite de novo.
    if (regras.situacaoConvite(atual) === 'EXPIRADO') {
      const [usuarios, pendentes] = await Promise.all([prisma.usuario.count({ where: { clienteId } }), pendentesDoTenant(clienteId, atual.id)]);
      await garantirDentroDoLimite({ clienteId, limite: 'usuarios', usoAtual: regras.usoComConvites(usuarios, pendentes) });
    }
    const token = regras.gerarToken();
    const convite = await prisma.conviteEquipe.update({
      where: { id: atual.id },
      data: { token, expiraEm: regras.calcularExpiracao() },
      select: CAMPOS_CONVITE,
    });
    const envio = await mandarConvite({ clienteId, convite, token, quemConvidou: await nomeDoSolicitante(req) });
    return res.json({ convite: formatar(convite), ...envio });
  } catch (e) {
    if (e.codigo === 'LIMITE_DO_PLANO') {
      return res.status(403).json({ erro: e.message, codigo: e.codigo, limite: e.limite, maximo: e.maximo, planoSugerido: e.planoSugerido });
    }
    console.error('[convites/reenviar]', e);
    return res.status(500).json({ erro: 'Não foi possível reenviar o convite.' });
  }
});

roteador.delete('/:id', async (req, res) => {
  try {
    const clienteId = req.usuario.clienteId;
    const atual = await prisma.conviteEquipe.findFirst({ where: { id: req.params.id, clienteId }, select: { id: true, aceitoEm: true, perfil: true } });
    if (!atual) return res.status(404).json({ erro: 'Convite não encontrado.' });
    if (atual.aceitoEm) return res.status(409).json({ erro: 'Este convite já foi aceito. Para tirar o acesso, remova a pessoa da equipe.' });
    if (req.usuario.perfil === 'ADMINISTRADOR' && atual.perfil === 'ADMINISTRADOR') {
      return res.status(403).json({ erro: 'Só a dona da conta mexe em convite de administrador.' });
    }
    await prisma.conviteEquipe.delete({ where: { id: atual.id } });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[convites/cancelar]', e);
    return res.status(500).json({ erro: 'Não foi possível cancelar o convite.' });
  }
});

module.exports = roteador;

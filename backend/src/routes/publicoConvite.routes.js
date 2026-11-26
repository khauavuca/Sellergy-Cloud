// Aceitar convite e criar senha (/convite/:token).
// Montado em /publico/convite (src/index.js). Frente C da fase 2.
//
//   GET  /publico/convite/:token  -> dados pra tela (nome, negocio, perfil)
//   POST /publico/convite/:token  -> { senha } cria o usuario e ja entra logado
//
// Publica (sem login) e com limite por IP. A sessao sai igual a do login
// (JWT no cookie httpOnly + segredo de CSRF no corpo, ver utils/sessaoCookie).

const express = require('express');
const { VERSAO_TERMOS, aceitouTermos } = require('../legal/versao');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const prisma = require('../prisma');
const { limiteDo, CAMPOS_ASSINATURA } = require('../planos/recursos');
const {
  gerarPermissoesCompletas, sanitizarPermissoes, garantirAgendaPropria,
} = require('../controllers/CrmUsuariosController');
const regras = require('../convites/regras');

const roteador = express.Router();

const limitadorLeitura = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Espere alguns minutos e tente de novo.' },
});
const limitadorAceite = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Espere alguns minutos e tente de novo.' },
});

// Permissoes de quem entra como equipe (VENDEDOR). A dona ajusta depois em
// Usuarios & Equipe. Filtradas pelo segmento (loja nao tem agenda etc.).
function permissoesIniciais(perfil, segmento, comEspecialista) {
  if (perfil === 'ADMINISTRADOR') return gerarPermissoesCompletas();
  const preset = {
    CRM: { visualizar: true, criar: true, editar: true },
    VENDAS: { visualizar: true, criar: true },
    CATALOGO: { visualizar: true },
    ESTOQUE: { visualizar: true },
    AGENDA: { visualizar: true, criar: true, editar: true, escopo: comEspecialista ? 'PROPRIAS' : 'TODAS' },
  };
  const limpas = sanitizarPermissoes(preset, segmento);
  return comEspecialista ? garantirAgendaPropria(limpas) : limpas;
}

function mascararTelefone(t) {
  const d = String(t || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length !== 11) return null;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

async function carregar(token) {
  if (!regras.tokenComFormatoValido(token)) return null;
  return prisma.conviteEquipe.findUnique({ where: { token } });
}

roteador.get('/:token', limitadorLeitura, async (req, res) => {
  try {
    const convite = await carregar(req.params.token);
    if (!convite) return res.status(404).json({ erro: 'Convite não encontrado. Peça um novo link pra quem te convidou.' });
    const situacao = regras.situacaoConvite(convite);
    const [negocio, quem, esp] = await Promise.all([
      prisma.cliente.findUnique({ where: { id: convite.clienteId }, select: { nome: true, brandNome: true } }),
      convite.criadoPorId ? prisma.usuario.findUnique({ where: { id: convite.criadoPorId }, select: { nome: true } }) : null,
      convite.especialistaId ? prisma.especialista.findFirst({ where: { id: convite.especialistaId, clienteId: convite.clienteId }, select: { nome: true } }) : null,
    ]);
    return res.json({
      situacao,
      nome: convite.nome,
      email: convite.email,
      telefone: mascararTelefone(convite.telefone),
      perfil: convite.perfil,
      negocio: negocio?.brandNome || negocio?.nome || null,
      convidadoPor: quem?.nome?.split(' ')[0] || null,
      especialista: esp?.nome || null,
      expiraEm: convite.expiraEm,
      senhaMinima: regras.SENHA_MINIMA,
    });
  } catch (e) {
    console.error('[publico/convite get]', e);
    return res.status(500).json({ erro: 'Não foi possível abrir o convite.' });
  }
});

roteador.post('/:token', limitadorAceite, async (req, res) => {
  try {
    const erroSenha = regras.validarSenha(req.body?.senha);
    if (erroSenha) return res.status(422).json({ erro: erroSenha, campos: ['senha'] });
    if (!aceitouTermos(req.body)) {
      return res.status(422).json({ erro: 'Para criar seu acesso, aceite os Termos de uso e a Política de privacidade.', campos: ['aceiteTermos'] });
    }

    const convite = await carregar(req.params.token);
    if (!convite) return res.status(404).json({ erro: 'Convite não encontrado. Peça um novo link pra quem te convidou.' });
    const situacao = regras.situacaoConvite(convite);
    if (situacao === 'ACEITO') return res.status(409).json({ erro: 'Este convite já foi usado. Entre com seu e-mail e senha.', codigo: 'CONVITE_USADO' });
    if (situacao === 'EXPIRADO') return res.status(410).json({ erro: 'Este convite venceu. Peça pra quem te convidou mandar de novo.', codigo: 'CONVITE_VENCIDO' });

    const cliente = await prisma.cliente.findUnique({
      where: { id: convite.clienteId }, select: { ...CAMPOS_ASSINATURA, status: true, segmento: true },
    });
    if (!cliente || cliente.status !== 'ACTIVE') return res.status(403).json({ erro: 'Esta conta não está ativa. Fale com quem te convidou.' });

    const senhaHash = await bcrypt.hash(req.body.senha, 12);
    const usuario = await prisma.$transaction(async (tx) => {
      // Trava o convite: so uma aceitacao passa (clique duplo, duas abas).
      const marcado = await tx.conviteEquipe.updateMany({
        where: { id: convite.id, aceitoEm: null, expiraEm: { gt: new Date() } },
        data: { aceitoEm: new Date() },
      });
      if (marcado.count !== 1) throw Object.assign(new Error('Este convite já foi usado.'), { status: 409 });

      const jaExiste = await tx.usuario.findUnique({ where: { email: convite.email }, select: { id: true } });
      if (jaExiste) throw Object.assign(new Error('Este e-mail já tem acesso. Entre com seu e-mail e senha.'), { status: 409 });

      // O convite ja ocupava vaga; confere de novo caso o plano tenha mudado.
      const usuarios = await tx.usuario.count({ where: { clienteId: convite.clienteId } });
      if (usuarios + 1 > limiteDo(cliente, 'usuarios')) {
        throw Object.assign(new Error('A equipe já está no limite do plano. Peça pra dona liberar uma vaga.'), { status: 403 });
      }

      let especialista = null;
      if (convite.especialistaId) {
        especialista = await tx.especialista.findFirst({
          where: { id: convite.especialistaId, clienteId: convite.clienteId, usuarioId: null }, select: { id: true },
        });
      }
      const criado = await tx.usuario.create({
        data: {
          nome: convite.nome,
          email: convite.email,
          senha: senhaHash,
          telefone: convite.telefone,
          clienteId: convite.clienteId,
          perfil: convite.perfil === 'ADMINISTRADOR' ? 'ADMINISTRADOR' : 'VENDEDOR',
          permissoes: permissoesIniciais(convite.perfil, cliente.segmento, Boolean(especialista)),
          deveTrocarSenha: false,
          termosAceitosEm: new Date(),
          versaoTermos: VERSAO_TERMOS,
        },
      });
      if (especialista) await tx.especialista.update({ where: { id: especialista.id }, data: { usuarioId: criado.id } });
      await tx.conviteEquipe.update({ where: { id: convite.id }, data: { usuarioId: criado.id } });
      return criado;
    });

    // Mesma sessao do login.
    const { responderSessao } = require('./auth.routes');
    return responderSessao(res, usuario, { mfa: false, status: 201 });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ erro: e.message });
    if (e.code === 'P2002') return res.status(409).json({ erro: 'Este e-mail já tem acesso. Entre com seu e-mail e senha.' });
    console.error('[publico/convite aceitar]', e);
    return res.status(500).json({ erro: 'Não foi possível criar seu acesso. Tente de novo.' });
  }
});

module.exports = roteador;

/**
 * Middlewares de autorizacao do Sellergy Cloud.
 *
 * Hierarquia:
 *   ADMIN          -> dono do sistema, acesso global, ignora modulosLiberados.
 *   CLIENT         -> dono do tenant, acesso total ao seu proprio tenant
 *                     (sujeito aos modulosLiberados pelo admin).
 *   ADMINISTRADOR  -> colaborador do tenant com permissoes completas (preset).
 *   VENDEDOR       -> colaborador do tenant com permissoes customizadas.
 *
 * O middlewareAutenticacao deve ser aplicado ANTES destes (req.usuario populado).
 * Ele confere o usuario no BANCO a cada pedido (seguranca/sessaoUsuario.js):
 * req.usuario.perfil/clienteId sao os atuais, nao os do login — quem e
 * rebaixado ou excluido perde o acesso na hora.
 */

const prisma = require('../prisma');
const { situacaoAssinatura } = require('../assinatura/situacao');
const { papelPode, papelDe } = require('../seguranca/papeis');

const METODOS_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

const PERFIS_TENANT = ['CLIENT', 'ADMINISTRADOR', 'VENDEDOR'];

const ehAdmin = (usuario) => usuario?.perfil === 'ADMIN';
const ehDonoTenant = (usuario) => usuario?.perfil === 'CLIENT';
const ehColaborador = (usuario) => usuario?.perfil === 'ADMINISTRADOR' || usuario?.perfil === 'VENDEDOR';
const ehDoTenant = (usuario) => PERFIS_TENANT.includes(usuario?.perfil);

/**
 * Bloqueia tudo que nao for ADMIN do sistema.
 */
function requerAdmin(req, res, next) {
  if (!ehAdmin(req.usuario)) {
    return res.status(403).json({ erro: 'Acesso restrito ao administrador do sistema.' });
  }
  return next();
}

/**
 * Equipe Sellergy por papel (DONO, SUPORTE, FINANCEIRO). Inclui o requerAdmin.
 * O papel e carregado do banco pelo middlewareAutenticacao
 * (req.usuario.papelAdmin). Matriz em seguranca/papeis.js.
 *
 *   roteador.post('/faturas/:id/pagar', requerPapelAdmin('cobranca.baixa'), ...)
 */
function requerPapelAdmin(acao) {
  // Valida a acao ja na montagem da rota (erro de digitacao quebra no boot).
  papelPode('DONO', acao);
  return function (req, res, next) {
    if (!ehAdmin(req.usuario)) {
      return res.status(403).json({ erro: 'Acesso restrito ao administrador do sistema.' });
    }
    if (!papelPode(req.usuario.papelAdmin, acao)) {
      return res.status(403).json({ erro: 'Seu papel na equipe não permite essa ação.', codigo: 'PAPEL_SEM_PERMISSAO', acao });
    }
    return next();
  };
}

/** Papel efetivo do admin logado (DONO quando nao carregado). */
function papelAdminDe(req) {
  return papelDe(req?.usuario?.papelAdmin);
}

/**
 * Permite ADMIN do sistema OU usuario com clienteId valido.
 */
function requerTenant(req, res, next) {
  if (ehAdmin(req.usuario)) return next();
  if (ehDoTenant(req.usuario) && req.usuario.clienteId) return next();
  return res.status(403).json({ erro: 'Acesso negado: usuario sem tenant.' });
}

/**
 * Verifica se o tenant tem o modulo liberado pelo admin.
 * ADMIN passa direto. CLIENT/ADMINISTRADOR/VENDEDOR sao bloqueados se o modulo nao esta liberado.
 *
 * @param {string} modulo - identificador do modulo (ex: 'BOTS', 'CRM', 'FINANCEIRO').
 */
function requerModuloLiberado(modulo) {
  return async function (req, res, next) {
    try {
      if (ehAdmin(req.usuario)) return next();

      if (!req.usuario?.clienteId) {
        return res.status(403).json({ erro: 'Acesso negado: usuario sem tenant.' });
      }

      const cliente = await prisma.cliente.findUnique({
        where: { id: req.usuario.clienteId },
        select: { modulosLiberados: true, status: true, plano: true, statusAssinatura: true, trialAte: true }
      });

      if (!cliente) {
        return res.status(403).json({ erro: 'Tenant nao encontrado.' });
      }

      if (cliente.status !== 'ACTIVE') {
        return res.status(403).json({ erro: 'Conta inativa ou suspensa.' });
      }

      // Bloqueio suave da assinatura: trial vencido / conta suspensa ainda
      // CONSULTA tudo (GET), mas nao cria nem altera. Nada e apagado.
      const situacao = situacaoAssinatura(cliente);
      if (situacao.somenteLeitura && !METODOS_LEITURA.has(req.method)) {
        return res.status(402).json({
          erro: situacao.aviso === 'TRIAL_VENCIDO'
            ? 'Seu teste grátis terminou. Escolha um plano para continuar registrando — seus dados estão salvos.'
            : 'Sua conta está em modo somente leitura por pendência na assinatura. Regularize para voltar a registrar.',
          codigo: 'ASSINATURA_BLOQUEADA',
          aviso: situacao.aviso,
        });
      }

      const modulos = cliente.modulosLiberados || {};
      if (modulos[modulo] !== true) {
        return res.status(403).json({ erro: `Modulo "${modulo}" nao esta liberado para este cliente.` });
      }

      return next();
    } catch (erro) {
      console.error('[requerModuloLiberado]', erro);
      return res.status(500).json({ erro: 'Erro ao validar modulo liberado.' });
    }
  };
}

/**
 * Verifica se o usuario tem a permissao especifica dentro de um modulo.
 * - ADMIN passa direto.
 * - CLIENT (dono do tenant) passa direto se o modulo esta liberado.
 * - ADMINISTRADOR (colaborador) passa direto (preset com tudo).
 * - VENDEDOR so passa se permissoes[modulo][acao] === true.
 *
 * Deve ser usado em conjunto com requerModuloLiberado(modulo).
 *
 * @param {string} modulo - ex: 'CRM'
 * @param {string} acao   - 'visualizar' | 'criar' | 'editar' | 'excluir'
 */
function requerPermissao(modulo, acao) {
  const acoesValidas = ['visualizar', 'criar', 'editar', 'excluir', 'responder', 'atribuir'];
  if (!acoesValidas.includes(acao)) {
    throw new Error(`Acao invalida: ${acao}. Use: ${acoesValidas.join(', ')}`);
  }

  return async function (req, res, next) {
    try {
      if (ehAdmin(req.usuario)) return next();
      if (ehDonoTenant(req.usuario)) return next();
      if (req.usuario?.perfil === 'ADMINISTRADOR') return next();

      // VENDEDOR (e qualquer outro perfil de tenant): verifica permissoes JSON.
      // O auth.middleware ja carregou o usuario do banco (cache de 30 s, limpo
      // quando a dona muda as permissoes): usa ele; senao consulta.
      const usuario = req.usuarioAtual && req.usuarioAtual.id === req.usuario.id
        ? req.usuarioAtual
        : await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { permissoes: true } });
      if (!usuario) return res.status(401).json({ erro: 'Sessão inválida. Entre de novo.' });

      const permissoes = usuario?.permissoes || {};
      const permissoesModulo = permissoes[modulo] || {};

      if (permissoesModulo[acao] !== true) {
        return res.status(403).json({
          erro: `Permissao negada: voce nao pode "${acao}" no modulo "${modulo}".`
        });
      }

      return next();
    } catch (erro) {
      console.error('[requerPermissao]', erro);
      return res.status(500).json({ erro: 'Erro ao validar permissao.' });
    }
  };
}

/**
 * Bloqueia VENDEDOR (mesmo com permissoes granulares concedidas).
 * Usado em decisoes estruturais do tenant que so podem ser feitas por quem
 * gerencia a conta — ex: configurar etapas do CRM, mexer em modulos.
 *
 * Permite: ADMIN do sistema, CLIENT (dono do tenant), ADMINISTRADOR.
 * Bloqueia: VENDEDOR.
 */
function requerPapelPrivilegiado(req, res, next) {
  if (ehAdmin(req.usuario)) return next();
  if (ehDonoTenant(req.usuario)) return next();
  if (req.usuario?.perfil === 'ADMINISTRADOR') return next();
  return res.status(403).json({
    erro: 'Acao restrita ao dono da conta ou administrador. Pede pra eles habilitarem pra voce.',
  });
}

/**
 * Retorna o escopo de um modulo para o usuario:
 *   - ADMIN / CLIENT / ADMINISTRADOR -> 'TODAS' (sempre veem tudo).
 *   - VENDEDOR -> permissoes[modulo].escopo (default 'PROPRIAS').
 * `permissoes` e o objeto Usuario.permissoes carregado do banco.
 * Usado pelas rotas que filtram registros por responsavel (ex.: inbox de Mensagens).
 */
function escopoDoUsuario(usuario, permissoes, modulo) {
  if (ehAdmin(usuario) || ehDonoTenant(usuario) || usuario?.perfil === 'ADMINISTRADOR') {
    return 'TODAS';
  }
  return permissoes?.[modulo]?.escopo === 'TODAS' ? 'TODAS' : 'PROPRIAS';
}

module.exports = {
  ehAdmin,
  ehDonoTenant,
  ehColaborador,
  ehDoTenant,
  requerAdmin,
  requerPapelAdmin,
  papelAdminDe,
  requerTenant,
  requerModuloLiberado,
  requerPermissao,
  requerPapelPrivilegiado,
  escopoDoUsuario,
  PERFIS_TENANT,
};

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
 */

const prisma = require('../prisma');
const { chaveTenant, ler, gravar, invalidarPrefixo } = require('../utils/cache');

const PERFIS_TENANT = ['CLIENT', 'ADMINISTRADOR', 'VENDEDOR'];

// ---------------------------------------------------------------------
// Cache (Redis, utils/cache.js) do que estes middlewares leem do banco em
// TODA requisicao de TODO modulo: modulos liberados + status do tenant, e as
// permissoes granulares do VENDEDOR. Sao dados que mudam raramente e so pela
// mao do admin/dono — as rotas que os alteram chamam invalidar*() abaixo,
// entao a mudanca vale na hora; o TTL e so rede de seguranca. Fail-open:
// Redis fora = volta a bater no banco como antes.
// ---------------------------------------------------------------------
const TTL_ACESSO_S = 60;
const NS_TENANT = 'tenant:acesso';
const NS_USUARIO = 'usuario:permissoes';

async function carregarAcessoTenant(clienteId) {
  let chave = null;
  try { chave = chaveTenant(NS_TENANT, { clienteId }); } catch { /* sem chave segura = sem cache */ }
  if (chave) {
    const emCache = await ler(chave);
    if (emCache) return emCache;
  }
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { modulosLiberados: true, status: true },
  });
  if (cliente && chave) gravar(chave, cliente, TTL_ACESSO_S); // fire-and-forget
  return cliente;
}

async function carregarPermissoesUsuario(usuario) {
  let chave = null;
  try { chave = chaveTenant(NS_USUARIO, { clienteId: usuario.clienteId, usuarioId: usuario.id }); } catch { /* idem */ }
  if (chave) {
    const emCache = await ler(chave);
    if (emCache) return emCache.permissoes || {};
  }
  const registro = await prisma.usuario.findUnique({ where: { id: usuario.id }, select: { permissoes: true } });
  const permissoes = registro?.permissoes || {};
  if (chave) gravar(chave, { permissoes }, TTL_ACESSO_S);
  return permissoes;
}

/** Chamar depois de alterar modulosLiberados/status de um cliente. */
async function invalidarAcessoTenant(clienteId) {
  if (!clienteId) return;
  await invalidarPrefixo(`cache:${NS_TENANT}:${clienteId}:`);
}

/** Chamar depois de alterar as permissoes de um usuario do tenant. */
async function invalidarPermissoesUsuario(clienteId, usuarioId) {
  if (!clienteId || !usuarioId) return;
  await invalidarPrefixo(`cache:${NS_USUARIO}:${clienteId}:${usuarioId}:`);
}

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

      const cliente = await carregarAcessoTenant(req.usuario.clienteId);

      if (!cliente) {
        return res.status(403).json({ erro: 'Tenant nao encontrado.' });
      }

      if (cliente.status !== 'ACTIVE') {
        return res.status(403).json({ erro: 'Conta inativa ou suspensa.' });
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
      const permissoes = await carregarPermissoesUsuario(req.usuario);
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
  requerTenant,
  requerModuloLiberado,
  requerPermissao,
  requerPapelPrivilegiado,
  escopoDoUsuario,
  invalidarAcessoTenant,
  invalidarPermissoesUsuario,
  PERFIS_TENANT,
};

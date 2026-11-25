const jwt = require('jsonwebtoken');
const { nomeSessao, lerCookie } = require('../utils/sessaoCookie');
const { requisicaoPermitidaEmSuporte } = require('../seguranca/sessaoSuporte');
const { papelDe, escritaLiberadaPara, DESATIVADO } = require('../seguranca/papeis');
const { camadaRecusada } = require('../seguranca/acessoAdmin');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET nao configurado. Defina a variavel de ambiente antes de iniciar o servidor.');
}

const SEGREDO_JWT = process.env.JWT_SECRET;

const METODOS_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);
const ROTAS_LIBERADAS_SEM_2FA = /^\/autenticacao\/(perfil|2fa\/configurar|2fa\/ativar|logout|trocar-senha)$/;

// Carregado sob demanda: o middleware e importado por modulos que rodam sem
// banco (testes de rota pura) e so o ADMIN precisa da consulta.
let prismaCache = null;
function obterPrisma() {
  if (!prismaCache) prismaCache = require('../prisma');
  return prismaCache;
}

/**
 * Equipe Sellergy (perfil ADMIN): papel e exigencia de 2FA vem do BANCO a cada
 * requisicao, pra trocar papel ou desativar alguem valer na hora (sem esperar
 * o token de 12 h vencer).
 */
async function conferirAdmin(req, res, next, decodificado) {
  let registro;
  try {
    registro = await obterPrisma().usuario.findUnique({
      where: { id: decodificado.id },
      select: { perfil: true, papelAdmin: true, permissoes: true, nome: true },
    });
  } catch (e) {
    console.error('[auth] falha ao carregar o admin', e?.message);
    return res.status(503).json({ erro: 'Não foi possível validar o acesso agora. Tente de novo.' });
  }
  if (!registro || registro.perfil !== 'ADMIN') {
    return res.status(401).json({ erro: 'Sessão inválida. Entre de novo.' });
  }
  const papel = papelDe(registro.papelAdmin);
  if (papel === DESATIVADO) {
    return res.status(403).json({ erro: 'Seu acesso ao painel foi desativado.', codigo: 'ADMIN_DESATIVADO' });
  }
  req.usuario.papelAdmin = papel;
  req.usuario.nome = registro.nome;

  const caminho = (req.originalUrl || '').split('?')[0];

  // ADMIN sem segundo fator so alcanca o necessario pra configura-lo. Vale pra
  // todos (ADMIN_2FA_OBRIGATORIO=true) ou pra quem o dono marcou "exigir 2FA".
  const exige2fa = process.env.ADMIN_2FA_OBRIGATORIO === 'true' || registro.permissoes?.exige2fa === true;
  if (exige2fa && !decodificado.mfa && !ROTAS_LIBERADAS_SEM_2FA.test(caminho)) {
    return res.status(403).json({ erro: 'Ative o código em 2 etapas para usar o painel de administração.', codigo: 'ADMIN_2FA_OBRIGATORIO' });
  }

  // Suporte e Financeiro so escrevem nas areas do papel (rotas antigas do
  // admin checam so "perfil ADMIN"). A rota ainda confere a acao exata.
  if (!METODOS_LEITURA.has(req.method) && !escritaLiberadaPara(papel, caminho)) {
    return res.status(403).json({ erro: 'Seu papel na equipe não permite essa ação.', codigo: 'PAPEL_SEM_PERMISSAO' });
  }
  return next();
}

/** Token de sessao de verdade: tem usuario e perfil e nao e etapa de login. PURA. */
function ehTokenDeSessao(dados) {
  return Boolean(dados && typeof dados === 'object' && dados.id && dados.perfil && !dados.etapa);
}

const middlewareAutenticacao = (req, res, next) => {
  // Navegador: o token vem no cookie httpOnly, fora do alcance do JavaScript
  // (um XSS nao consegue le-lo). Clientes fora do navegador — scripts,
  // integracoes servidor-a-servidor — continuam usando Authorization: Bearer.
  const tokenCookie = lerCookie(req, nomeSessao(req));
  let token = tokenCookie;

  if (!token) {
    const cabecalhoAuth = req.headers.authorization;

    if (!cabecalhoAuth) {
      return res.status(401).json({ erro: 'Token nao fornecido' });
    }

    const partes = cabecalhoAuth.split(' ');
    if (partes.length !== 2 || partes[0] !== 'Bearer' || !partes[1]) {
      return res.status(401).json({ erro: 'Formato de token invalido' });
    }

    token = partes[1];
  }

  let decodificado;
  try {
    decodificado = jwt.verify(token, SEGREDO_JWT);
  } catch (erro) {
    return res.status(401).json({ erro: 'Token invalido ou expirado' });
  }

  // So token de SESSAO abre a API. O desafio do 2FA (etapa: '2fa') e assinado
  // com o mesmo segredo, mas so vale em POST /autenticacao/login/2fa: aceitar
  // ele aqui deixava pular o segundo fator (trocar senha/e-mail so com a senha).
  if (!ehTokenDeSessao(decodificado)) {
    return res.status(401).json({ erro: 'Token invalido ou expirado' });
  }

  // Painel (crm.) e site do cliente sao camadas separadas: a sessao de uma
  // nao serve na outra, mesmo com o cookie da API valendo pras duas.
  if (camadaRecusada({ origem: req.get?.('origin'), host: req.hostname, perfil: decodificado.perfil, suporte: decodificado.suporte })) {
    return res.status(401).json({ erro: 'Sessão inválida neste endereço. Entre de novo.' });
  }

  req.usuario = decodificado;
  // Sinaliza a origem da credencial: so a sessao por cookie e enviada
  // automaticamente pelo navegador, logo so ela precisa de defesa de CSRF.
  req.sessaoPorCookie = Boolean(tokenCookie);

  // Sessao de suporte (admin vendo a conta do cliente): SO LEITURA.
  // Ver seguranca/sessaoSuporte.js.
  if (decodificado.suporte) {
    const caminho = (req.originalUrl || '').split('?')[0];
    if (!requisicaoPermitidaEmSuporte(req.method, caminho)) {
      return res.status(403).json({
        erro: 'Sessão de suporte, só leitura: nada pode ser criado ou alterado.',
        codigo: 'SESSAO_SUPORTE_SO_LEITURA',
      });
    }
    return next();
  }

  if (decodificado.perfil === 'ADMIN') {
    return conferirAdmin(req, res, next, decodificado);
  }
  return next();
};

module.exports = middlewareAutenticacao;
module.exports.SEGREDO_JWT = SEGREDO_JWT;
module.exports.ehTokenDeSessao = ehTokenDeSessao;

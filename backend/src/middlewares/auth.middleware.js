const jwt = require('jsonwebtoken');
const { NOME_SESSAO, lerCookie } = require('../utils/sessaoCookie');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET nao configurado. Defina a variavel de ambiente antes de iniciar o servidor.');
}

const SEGREDO_JWT = process.env.JWT_SECRET;

const middlewareAutenticacao = (req, res, next) => {
  // Navegador: o token vem no cookie httpOnly, fora do alcance do JavaScript
  // (um XSS nao consegue le-lo). Clientes fora do navegador — scripts,
  // integracoes servidor-a-servidor — continuam usando Authorization: Bearer.
  const tokenCookie = lerCookie(req, NOME_SESSAO);
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

  try {
    const decodificado = jwt.verify(token, SEGREDO_JWT);
    req.usuario = decodificado;
    // Sinaliza a origem da credencial: so a sessao por cookie e enviada
    // automaticamente pelo navegador, logo so ela precisa de defesa de CSRF.
    req.sessaoPorCookie = Boolean(tokenCookie);

    // ADMIN sem segundo fator so alcanca o necessario pra configura-lo.
    if (process.env.ADMIN_2FA_OBRIGATORIO === 'true' && decodificado.perfil === 'ADMIN' && !decodificado.mfa) {
      const caminho = (req.originalUrl || '').split('?')[0];
      const liberado = /^\/autenticacao\/(perfil|2fa\/configurar|2fa\/ativar|logout|trocar-senha)$/.test(caminho);
      if (!liberado) {
        return res.status(403).json({ erro: 'Ative o código em 2 etapas para usar o painel de administração.', codigo: 'ADMIN_2FA_OBRIGATORIO' });
      }
    }
    return next();
  } catch (erro) {
    return res.status(401).json({ erro: 'Token invalido ou expirado' });
  }
};

module.exports = middlewareAutenticacao;
module.exports.SEGREDO_JWT = SEGREDO_JWT;

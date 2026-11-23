// =====================================================================
// SESSAO DE SUPORTE ("entrar como suporte") — so leitura, 30 minutos.
// =====================================================================
// Desenho escolhido (mais simples e mais seguro):
//
//   1. O admin (papel DONO ou SUPORTE) pede POST /admin/suporte/sessao.
//   2. A API emite um JWT de 30 min NO LUGAR do cookie de sessao do admin:
//      o token e do dono do negocio (perfil CLIENT, clienteId do tenant) e
//      carrega o claim `suporte: { adminId, adminNome, sessaoId, clienteNome }`.
//   3. auth.middleware ve o claim e recusa qualquer metodo que nao seja
//      GET/HEAD/OPTIONS (403 SESSAO_SUPORTE_SO_LEITURA). A unica escrita
//      aceita e encerrar a propria sessao.
//   4. Encerrar (ou os 30 min passarem) apaga o cookie. O admin volta pra
//      tela de login do painel e entra de novo (senha + 2FA).
//
// Por que nao guardar a sessao do admin pra "voltar" sozinho: o cookie e por
// dominio (nao da pra ter duas sessoes em abas diferentes) e guardar o token
// do admin em outro cookie ou no navegador deixaria uma credencial de admin
// viva e esquecida durante o suporte. Exigir login de novo custa 20 segundos
// e nao deixa nada pra tras. Tudo fica na auditoria (entrar e sair).
// =====================================================================

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const DURACAO_MIN = 30;
const METODOS_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

// Escritas permitidas DURANTE a sessao de suporte (so pra sair dela).
const ESCRITAS_LIBERADAS = [
  /^\/suporte\/sessao\/encerrar$/,
  /^\/autenticacao\/logout$/,
];

function requisicaoPermitidaEmSuporte(metodo, caminho) {
  if (METODOS_LEITURA.has(String(metodo || '').toUpperCase())) return true;
  const c = String(caminho || '').split('?')[0];
  return ESCRITAS_LIBERADAS.some((re) => re.test(c));
}

/**
 * Monta o token da sessao de suporte. `usuarioAlvo` e o dono do negocio
 * (Usuario do tenant). Devolve { token, sessaoId, expiraEm }.
 */
function criarTokenSuporte({ segredo, usuarioAlvo, admin, clienteNome, agora = Date.now() }) {
  if (!usuarioAlvo?.id || !usuarioAlvo?.clienteId) throw new Error('Usuario alvo invalido para sessao de suporte.');
  if (!admin?.id) throw new Error('Admin invalido para sessao de suporte.');
  const sessaoId = crypto.randomUUID();
  const expiraEm = new Date(agora + DURACAO_MIN * 60 * 1000);
  const token = jwt.sign(
    {
      id: usuarioAlvo.id,
      perfil: usuarioAlvo.perfil,
      clienteId: usuarioAlvo.clienteId,
      suporte: {
        adminId: admin.id,
        adminNome: admin.nome || 'Suporte Sellergy',
        sessaoId,
        clienteNome: clienteNome || null,
        expiraEm: expiraEm.toISOString(),
      },
    },
    segredo,
    { expiresIn: `${DURACAO_MIN}m` },
  );
  return { token, sessaoId, expiraEm };
}

module.exports = { DURACAO_MIN, requisicaoPermitidaEmSuporte, criarTokenSuporte };

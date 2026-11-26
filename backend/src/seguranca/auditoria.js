// =====================================================================
// AUDITORIA DO PAINEL ADMIN
// =====================================================================
// Tudo que alguem da equipe Sellergy faz (na conta de um cliente ou na
// plataforma) vira uma linha em AuditoriaAdmin. A aplicacao so INSERE: nao
// existe rota de update nem delete.
//
//   await registrarAuditoria(req, {
//     acao: 'ASSINATURA_SUSPENDER',
//     alvoTipo: 'CLIENTE', alvoId: clienteId,
//     detalhes: { motivo },
//   });
//
// Nunca derruba a acao principal: se gravar falhar, loga e segue (a acao ja
// aconteceu; perder a requisicao por causa do log seria pior).
// =====================================================================

const prisma = require('../prisma');

const LIMITE_DETALHES = 4000; // caracteres do JSON

/** IP do cliente. Com `trust proxy` configurado o Express ja resolve req.ip. */
function ipDaRequisicao(req) {
  const ip = req?.ip || req?.socket?.remoteAddress || null;
  if (!ip) return null;
  return String(ip).replace(/^::ffff:/, '').slice(0, 64);
}

/** Corta detalhes enormes e remove chaves que nunca devem ir pro log. */
function limparDetalhes(detalhes) {
  if (detalhes === undefined || detalhes === null) return null;
  const PROIBIDAS = /senha|token|segredo|secret|apikey|api_key|codigo2fa/i;
  const limpo = JSON.parse(JSON.stringify(detalhes, (k, v) => (k && PROIBIDAS.test(k) ? '[omitido]' : v)));
  const texto = JSON.stringify(limpo);
  if (texto.length <= LIMITE_DETALHES) return limpo;
  return { resumo: texto.slice(0, LIMITE_DETALHES), cortado: true };
}

async function nomeDoUsuario(req) {
  if (req?.usuario?.nome) return req.usuario.nome;
  const id = req?.usuario?.id;
  if (!id) return 'Sistema';
  const u = await prisma.usuario.findUnique({ where: { id }, select: { nome: true } }).catch(() => null);
  return u?.nome || 'Desconhecido';
}

async function registrarAuditoria(req, { acao, alvoTipo = null, alvoId = null, detalhes = null } = {}) {
  if (!acao) throw new Error('registrarAuditoria: acao obrigatoria.');
  try {
    // Na sessao de suporte quem age e o admin, nao o dono do negocio.
    const suporte = req?.usuario?.suporte;
    const usuarioId = suporte?.adminId || req?.usuario?.id || null;
    const usuarioNome = suporte?.adminNome || (await nomeDoUsuario(req));
    return await prisma.auditoriaAdmin.create({
      data: {
        usuarioId,
        usuarioNome: String(usuarioNome).slice(0, 120),
        acao: String(acao).slice(0, 80),
        alvoTipo: alvoTipo ? String(alvoTipo).slice(0, 40) : null,
        alvoId: alvoId ? String(alvoId).slice(0, 80) : null,
        detalhes: limparDetalhes(detalhes),
        ip: ipDaRequisicao(req),
      },
    });
  } catch (e) {
    console.error('[auditoria] falhou ao gravar', acao, e?.message);
    return null;
  }
}

module.exports = { registrarAuditoria, ipDaRequisicao, limparDetalhes };

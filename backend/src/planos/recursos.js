// =====================================================================
// RECURSOS E LIMITES DO PLANO — como o backend aplica o catalogo.
// =====================================================================
// Duas perguntas, sempre pelo plano EFETIVO (trial = Profissional):
//   - temRecurso(cliente, 'campanhas')        -> pode usar a funcao?
//   - limiteDo(cliente, 'profissionais')       -> quantos pode ter?
//
// Nas rotas:
//   router.post('/', exigirRecurso('campanhas'), handler)
//   await garantirDentroDoLimite({ clienteId, limite: 'usuarios', usoAtual })
//
// Erros saem com `codigo` estavel pro front mostrar "faca upgrade":
//   403 PLANO_SEM_RECURSO  { recurso, planoSugerido }
//   403 LIMITE_DO_PLANO    { limite, maximo, planoSugerido }
// =====================================================================

const prisma = require('../prisma');
const { PLANOS, obterPlano } = require('./catalogo');
const { situacaoAssinatura } = require('../assinatura/situacao');

const CAMPOS_ASSINATURA = { plano: true, statusAssinatura: true, trialAte: true };

function planoEfetivo(cliente, agora = new Date()) {
  return obterPlano(situacaoAssinatura(cliente, agora).planoEfetivo);
}

function temRecurso(cliente, recurso, agora = new Date()) {
  return planoEfetivo(cliente, agora).recursos[recurso] === true;
}

function limiteDo(cliente, limite, agora = new Date()) {
  const valor = planoEfetivo(cliente, agora).limites[limite];
  return typeof valor === 'number' ? valor : 0;
}

// Plano mais barato que libera o recurso (ou comporta o uso) — vai na
// resposta de erro pro front oferecer o upgrade certo.
function planoMaisBaratoCom(teste) {
  return Object.values(PLANOS)
    .sort((a, b) => a.precoMensal - b.precoMensal)
    .find(teste)?.codigo || null;
}

async function carregarCliente(clienteId) {
  return prisma.cliente.findUnique({ where: { id: clienteId }, select: CAMPOS_ASSINATURA });
}

/** Middleware: barra a rota se o plano efetivo nao tem o recurso. ADMIN passa. */
function exigirRecurso(recurso) {
  return async function (req, res, next) {
    try {
      if (req.usuario?.perfil === 'ADMIN') return next();
      const clienteId = req.usuario?.clienteId;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: usuario sem tenant.' });
      const cliente = await carregarCliente(clienteId);
      if (!cliente) return res.status(403).json({ erro: 'Tenant nao encontrado.' });
      if (temRecurso(cliente, recurso)) return next();
      const sugerido = planoMaisBaratoCom((p) => p.recursos[recurso] === true);
      return res.status(403).json({
        erro: `Seu plano não inclui este recurso. Disponível a partir do plano ${obterPlano(sugerido).nome}.`,
        codigo: 'PLANO_SEM_RECURSO',
        recurso,
        planoSugerido: sugerido,
      });
    } catch (e) {
      console.error('[exigirRecurso]', e);
      return res.status(500).json({ erro: 'Erro ao validar o plano.' });
    }
  };
}

/**
 * Igual a exigirRecurso, mas so barra o que ESCREVE (POST/PUT/PATCH/DELETE).
 * A tela continua carregando (GET) e mostra o convite de upgrade em vez de
 * quebrar com 403.
 */
function exigirRecursoNaEscrita(recurso) {
  const exigir = exigirRecurso(recurso);
  return function (req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    return exigir(req, res, next);
  };
}

/**
 * Lanca erro (status 403, codigo LIMITE_DO_PLANO) se `usoAtual + 1` passar
 * do limite. Chamar ANTES de criar o registro.
 */
async function garantirDentroDoLimite({ clienteId, limite, usoAtual, cliente = null }) {
  const c = cliente || (await carregarCliente(clienteId));
  if (!c) return;
  const maximo = limiteDo(c, limite);
  if (usoAtual + 1 <= maximo) return;
  const sugerido = planoMaisBaratoCom((p) => (p.limites[limite] ?? 0) >= usoAtual + 1);
  throw Object.assign(new Error(
    `Seu plano permite até ${maximo} ${limite === 'profissionais' ? 'profissionais' : 'usuários'}.`
    + (sugerido ? ` Passe para o plano ${obterPlano(sugerido).nome} para cadastrar mais.` : ''),
  ), { status: 403, codigo: 'LIMITE_DO_PLANO', limite, maximo, planoSugerido: sugerido });
}

module.exports = {
  CAMPOS_ASSINATURA,
  planoEfetivo,
  temRecurso,
  limiteDo,
  exigirRecurso,
  exigirRecursoNaEscrita,
  garantirDentroDoLimite,
  planoMaisBaratoCom,
};

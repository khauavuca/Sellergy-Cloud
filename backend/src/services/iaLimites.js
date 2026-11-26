// Travas de custo da IA (DeepSeek, chave da plataforma). Decisoes do dono
// (docs/custos-e-ajustes-integracoes.md §3.3 e §4):
//
//   1. Teto GLOBAL por dia (IA_TETO_DIARIO_TOKENS): estourou, a IA desliga
//      pra todos os clientes ate o dia virar (fuso de Sao Paulo) e fica um
//      alerta na Saude do admin. Trava de seguranca contra bug/loop geral.
//   2. Teto duro por CLIENTE: cota do mes (iaTokensIncluidosMes, 2 milhoes no
//      Negocio) + excedente autorizado (iaExcedenteAutorizadoTokens, padrao
//      0). Acabou: o bot volta pro menu de perguntas sem IA e o dono recebe
//      UMA notificacao no mes. Soma todos os bots do cliente.
//   3. Limite por CONTATO (services/limiteContato.js): N respostas de IA por
//      hora pro mesmo telefone.
//
// Tudo aqui "falha fechado" so no que custa dinheiro: erro ao ler o consumo
// nao derruba o atendimento, mas desliga a IA daquela mensagem (cai no menu).

const prisma = require('../prisma');
const { criarNotificacao } = require('../utils/notificacoes');
const { permitirRespostaIA } = require('./limiteContato');

const FUSO = 'America/Sao_Paulo';
const TETO_DIARIO_PADRAO = 20_000_000; // ~6.000 respostas/dia na plataforma toda

function tetoDiarioTokens() {
  const bruto = process.env.IA_TETO_DIARIO_TOKENS;
  if (bruto === undefined || bruto === '') return TETO_DIARIO_PADRAO;
  const n = Number(bruto);
  // 0 e valido: desliga a IA da plataforma inteira (interruptor de emergencia).
  return Number.isInteger(n) && n >= 0 ? n : TETO_DIARIO_PADRAO;
}

/** "AAAA-MM-DD" no fuso de Sao Paulo. */
function diaAtual(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/**
 * Regra pura da cota do cliente.
 * @returns {{ limite:number, restante:number, esgotada:boolean }}
 */
function avaliarCota({ usadoMes, tokensIncluidosMes, excedenteAutorizado = 0 }) {
  const limite = Math.max(0, Number(tokensIncluidosMes) || 0) + Math.max(0, Number(excedenteAutorizado) || 0);
  const usado = Math.max(0, Number(usadoMes) || 0);
  return { limite, restante: Math.max(0, limite - usado), esgotada: usado >= limite };
}

/** Regra pura do teto global. */
function avaliarTetoGlobal({ tokensHoje, teto }) {
  return { bloqueado: (Number(tokensHoje) || 0) >= teto, tokensHoje: Number(tokensHoje) || 0, teto };
}

async function situacaoTetoGlobal(agora = new Date()) {
  const teto = tetoDiarioTokens();
  const linha = await prisma.consumoIADiario.findUnique({ where: { dia: diaAtual(agora) } });
  return { ...avaliarTetoGlobal({ tokensHoje: linha?.tokensUsados || 0, teto }), tetoAtingidoEm: linha?.tetoAtingidoEm || null };
}

/** Tokens de IA do cliente no mes (todos os bots). */
async function consumoDoClienteNoMes(clienteId, periodo) {
  const r = await prisma.consumoIA.aggregate({ where: { clienteId, periodo }, _sum: { tokensUsados: true } });
  return r?._sum?.tokensUsados || 0;
}

/** Avisa o dono (1x por mes por bot) que a cota acabou e o bot foi pro menu. */
async function avisarCotaEsgotada({ bot, periodo }) {
  await prisma.consumoIA.upsert({
    where: { botId_periodo: { botId: bot.id, periodo } },
    create: { clienteId: bot.clienteId, botId: bot.id, periodo },
    update: {},
  });
  const marcado = await prisma.consumoIA.updateMany({
    where: { botId: bot.id, periodo, cotaEsgotadaAvisadaEm: null },
    data: { cotaEsgotadaAvisadaEm: new Date() },
  });
  if (marcado.count === 0) return false; // ja avisado neste mes
  await criarNotificacao(prisma, {
    clienteId: bot.clienteId,
    tipo: 'GENERICA',
    titulo: 'A cota de IA do mês acabou',
    mensagem: 'O atendimento com IA usou toda a cota incluída no plano. Até o mês virar, o bot responde pelo menu de perguntas, sem IA. Para continuar com IA, fale com o suporte sobre um pacote extra.',
    link: '/app/bots',
    dados: { botId: bot.id, periodo },
  });
  return true;
}

/**
 * Pode usar IA nesta mensagem? Ordem: teto global -> cota do cliente ->
 * limite por contato (o ultimo registra a resposta, por isso vem por ultimo).
 * @param {{ bot: object, de?: string, periodo: string }} p
 * @returns {Promise<{ liberado: true } | { liberado: false, motivo: 'TETO_GLOBAL'|'COTA_ESGOTADA'|'LIMITE_CONTATO'|'ERRO_CONSUMO' }>}
 */
async function verificarDisponibilidadeIA({ bot, de, periodo }) {
  try {
    const global = await situacaoTetoGlobal();
    if (global.bloqueado) return { liberado: false, motivo: 'TETO_GLOBAL' };

    const usadoMes = await consumoDoClienteNoMes(bot.clienteId, periodo);
    const cota = avaliarCota({
      usadoMes,
      tokensIncluidosMes: bot.iaTokensIncluidosMes,
      excedenteAutorizado: bot.iaExcedenteAutorizadoTokens,
    });
    if (cota.esgotada) {
      avisarCotaEsgotada({ bot, periodo }).catch((e) => console.error('[iaLimites] aviso de cota', e?.message));
      return { liberado: false, motivo: 'COTA_ESGOTADA' };
    }
  } catch (e) {
    console.error('[iaLimites] falha ao ler consumo — IA desligada nesta mensagem', e?.message);
    return { liberado: false, motivo: 'ERRO_CONSUMO' };
  }

  if (de && !permitirRespostaIA(bot.id, de)) return { liberado: false, motivo: 'LIMITE_CONTATO' };
  return { liberado: true };
}

/** Soma no consumo diario da plataforma (atomico) e marca o alerta se estourou. */
async function registrarConsumoGlobal(tokens, agora = new Date()) {
  if (!tokens) return null;
  const dia = diaAtual(agora);
  const linha = await prisma.consumoIADiario.upsert({
    where: { dia },
    create: { dia, tokensUsados: tokens },
    update: { tokensUsados: { increment: tokens } },
  });
  const teto = tetoDiarioTokens();
  if (linha.tokensUsados >= teto && !linha.tetoAtingidoEm) {
    const marcado = await prisma.consumoIADiario.updateMany({ where: { dia, tetoAtingidoEm: null }, data: { tetoAtingidoEm: new Date() } });
    if (marcado.count > 0) {
      console.error(`[ALERTA][iaLimites] teto diario de IA atingido (${linha.tokensUsados} >= ${teto} tokens em ${dia}). IA desligada para todos ate o dia virar.`);
    }
  }
  return linha;
}

module.exports = {
  TETO_DIARIO_PADRAO,
  tetoDiarioTokens,
  diaAtual,
  avaliarCota,
  avaliarTetoGlobal,
  situacaoTetoGlobal,
  consumoDoClienteNoMes,
  avisarCotaEsgotada,
  verificarDisponibilidadeIA,
  registrarConsumoGlobal,
};

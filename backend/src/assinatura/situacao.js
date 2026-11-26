// =====================================================================
// SITUACAO DA ASSINATURA — regra pura (sem banco), testavel.
// =====================================================================
// Decide, a partir dos campos do Cliente, se a conta pode operar, se esta
// em modo somente leitura e qual plano vale agora.
//
// Ciclo:
//   TRIAL (14 dias, plano Profissional) --assina--> ATIVA
//   TRIAL vencido sem assinar ----------> somente leitura (nao apaga nada)
//   ATIVA --fatura vence--> ATRASADA (avisa, continua operando)
//   ATRASADA --DIAS_ATE_SUSPENDER--> SUSPENSA (somente leitura)
//   qualquer --pagou--> ATIVA
//
// "Somente leitura" e o bloqueio suave: o cliente ainda entra, consulta e
// exporta tudo, mas nao cria/edita. Nunca apagamos dado por atraso.
// =====================================================================

const { PLANO_DO_TRIAL } = require('../planos/catalogo');

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_ATE_SUSPENDER = 10;

/**
 * @param {{ plano?: string, statusAssinatura?: string, trialAte?: Date|string|null }} cliente
 * @param {Date} [agora]
 * @returns {{
 *   status: string, podeOperar: boolean, somenteLeitura: boolean,
 *   planoEfetivo: string, diasRestantesTrial: number|null,
 *   aviso: null|'TRIAL_ACABANDO'|'TRIAL_VENCIDO'|'PAGAMENTO_ATRASADO'|'CONTA_SUSPENSA'|'CONTA_CANCELADA'
 * }}
 */
function situacaoAssinatura(cliente, agora = new Date()) {
  const status = cliente?.statusAssinatura || 'ATIVA';
  const planoContratado = cliente?.plano || 'BASIC';
  const base = {
    status,
    podeOperar: true,
    somenteLeitura: false,
    planoEfetivo: planoContratado,
    diasRestantesTrial: null,
    aviso: null,
  };

  if (status === 'TRIAL') {
    const fim = cliente?.trialAte ? new Date(cliente.trialAte) : null;
    const restanteMs = fim ? fim.getTime() - agora.getTime() : -1;
    if (restanteMs <= 0) {
      return { ...base, podeOperar: false, somenteLeitura: true, diasRestantesTrial: 0, aviso: 'TRIAL_VENCIDO' };
    }
    const dias = Math.ceil(restanteMs / DIA_MS);
    return {
      ...base,
      planoEfetivo: PLANO_DO_TRIAL,
      diasRestantesTrial: dias,
      aviso: dias <= 3 ? 'TRIAL_ACABANDO' : null,
    };
  }

  if (status === 'ATRASADA') return { ...base, aviso: 'PAGAMENTO_ATRASADO' };
  if (status === 'SUSPENSA') return { ...base, podeOperar: false, somenteLeitura: true, aviso: 'CONTA_SUSPENSA' };
  if (status === 'CANCELADA') return { ...base, podeOperar: false, somenteLeitura: true, aviso: 'CONTA_CANCELADA' };
  return base;
}

/**
 * Proximo status a partir das faturas (usado pelo cron de assinaturas).
 * @param {{ statusAtual: string, faturaVencidaMaisAntiga?: Date|null, agora?: Date }} p
 */
function proximoStatusPorFaturas({ statusAtual, faturaVencidaMaisAntiga = null, agora = new Date() }) {
  if (statusAtual === 'TRIAL' || statusAtual === 'CANCELADA') return statusAtual;
  if (!faturaVencidaMaisAntiga) return 'ATIVA';
  const diasAtraso = Math.floor((agora.getTime() - new Date(faturaVencidaMaisAntiga).getTime()) / DIA_MS);
  if (diasAtraso >= DIAS_ATE_SUSPENDER) return 'SUSPENSA';
  return 'ATRASADA';
}

module.exports = { situacaoAssinatura, proximoStatusPorFaturas, DIAS_ATE_SUSPENDER, DIA_MS };

// =====================================================================
// CATALOGO DE PLANOS — fonte unica de preco, limites e recursos.
// =====================================================================
// Os tres planos da proposta de 21/11/2026 (doc "Mercado, modelo de negocio
// e fluxos"): preco FIXO por negocio, nunca por profissional.
//
// O enum `Plano` do banco continua BASIC/PRO/PREMIUM (evita migracao de dado);
// aqui cada valor ganha o nome comercial:
//   BASIC   -> Essencial
//   PRO     -> Profissional
//   PREMIUM -> Negocio
//
// Mudar preco/limite/recurso = mudar SO este arquivo. Front le via
// GET /publico/planos, o backend aplica via ./recursos.js.
// =====================================================================

const ILIMITADO = Number.POSITIVE_INFINITY;

const PLANOS = Object.freeze({
  BASIC: Object.freeze({
    codigo: 'BASIC',
    nome: 'Essencial',
    precoMensal: 59,
    descricao: '1 loja ou até 2 profissionais',
    limites: Object.freeze({
      usuarios: 2,
      profissionais: 2,
      // Lembretes/confirmacoes de agendamento por WhatsApp por mes.
      lembretesMes: 300,
    }),
    recursos: Object.freeze({
      vendas: true,
      estoque: true,
      agenda: true,
      financeiro: true,
      lembretesWhatsapp: true,
      pagamentos: true,
      notaFiscal: false,
      campanhas: false,
      pacotes: false,
      linkAgendamento: false,
      catalogoOnline: false,
      atendimentoIa: false,
      relatoriosAvancados: false,
    }),
  }),
  PRO: Object.freeze({
    codigo: 'PRO',
    nome: 'Profissional',
    precoMensal: 119,
    descricao: 'até 5 usuários ou profissionais',
    limites: Object.freeze({
      usuarios: 5,
      profissionais: 5,
      lembretesMes: 1000,
    }),
    recursos: Object.freeze({
      vendas: true,
      estoque: true,
      agenda: true,
      financeiro: true,
      lembretesWhatsapp: true,
      pagamentos: true,
      notaFiscal: true,
      campanhas: true,
      pacotes: true,
      linkAgendamento: true,
      catalogoOnline: true,
      atendimentoIa: false,
      relatoriosAvancados: false,
    }),
  }),
  PREMIUM: Object.freeze({
    codigo: 'PREMIUM',
    nome: 'Negócio',
    precoMensal: 199,
    descricao: 'até 10 pessoas ou mais de uma unidade',
    limites: Object.freeze({
      usuarios: 10,
      profissionais: 10,
      lembretesMes: 3000,
    }),
    recursos: Object.freeze({
      vendas: true,
      estoque: true,
      agenda: true,
      financeiro: true,
      lembretesWhatsapp: true,
      pagamentos: true,
      notaFiscal: true,
      campanhas: true,
      pacotes: true,
      linkAgendamento: true,
      catalogoOnline: true,
      atendimentoIa: true,
      relatoriosAvancados: true,
    }),
  }),
});

// Durante o teste gratis o cliente experimenta o plano Profissional inteiro:
// e o plano que queremos vender, e testar o Essencial esconderia o link de
// agendamento e a nota fiscal (os gatilhos de compra).
const PLANO_DO_TRIAL = 'PRO';
const DIAS_DE_TRIAL = 14;
const DESCONTO_ANUAL = 0.2;

const RECURSOS = Object.freeze(Object.keys(PLANOS.BASIC.recursos));
const LIMITES = Object.freeze(Object.keys(PLANOS.BASIC.limites));

function obterPlano(codigo) {
  return PLANOS[codigo] || PLANOS.BASIC;
}

/** Versao serializavel (JSON nao tem Infinity) pra mandar pro front. */
function planosPublicos() {
  return Object.values(PLANOS).map((p) => ({
    codigo: p.codigo,
    nome: p.nome,
    precoMensal: p.precoMensal,
    precoAnualMensal: Math.round(p.precoMensal * (1 - DESCONTO_ANUAL) * 100) / 100,
    descricao: p.descricao,
    limites: Object.fromEntries(Object.entries(p.limites).map(([k, v]) => [k, v === ILIMITADO ? null : v])),
    recursos: { ...p.recursos },
  }));
}

module.exports = {
  PLANOS,
  PLANO_DO_TRIAL,
  DIAS_DE_TRIAL,
  DESCONTO_ANUAL,
  RECURSOS,
  LIMITES,
  ILIMITADO,
  obterPlano,
  planosPublicos,
};

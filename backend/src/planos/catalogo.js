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
//
// PRECO E LIMITES EDITAVEIS PELO ADMIN (fase 2): a tabela PlanoConfig
// sobrepoe preco mensal e limites deste arquivo (linha ausente = vale o
// codigo). `obterPlano` continua SINCRONO: o override fica num cache em
// memoria (PLANOS) que ./sincronizacao.js carrega no boot, recarrega ao
// salvar e a cada 5 min (outros processos, ex. o worker, tambem ouvem o aviso
// pelo Redis pub/sub). Recursos (o que cada plano libera) continuam so aqui.
// =====================================================================

const ILIMITADO = Number.POSITIVE_INFINITY;

const PLANOS_BASE = Object.freeze({
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
      // Notas fiscais (NFC-e + NFS-e) emitidas por mes. Essencial nao tem nota.
      notasMes: 0,
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
      notasMes: 100,
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
      notasMes: 300,
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

const RECURSOS = Object.freeze(Object.keys(PLANOS_BASE.BASIC.recursos));
const LIMITES = Object.freeze(Object.keys(PLANOS_BASE.BASIC.limites));

// Cache em memoria com o plano EFETIVO (codigo + override do banco). O objeto
// e o mesmo durante toda a vida do processo (quem importou PLANOS ve a troca);
// cada plano dentro dele e congelado.
const PLANOS = {};
let overridesAtuais = [];

function limitesValidos(limites) {
  const saida = {};
  if (!limites || typeof limites !== 'object') return saida;
  for (const chave of LIMITES) {
    const v = limites[chave];
    if (v === null) saida[chave] = ILIMITADO; // null no banco = ilimitado
    else if (Number.isInteger(v) && v >= 0) saida[chave] = v;
  }
  return saida;
}

/**
 * Aplica as linhas de PlanoConfig ({ codigo, precoMensal, limites }) sobre o
 * catalogo do codigo. Linha invalida ou de plano inexistente e ignorada.
 */
function aplicarOverrides(linhas = []) {
  const porCodigo = new Map((Array.isArray(linhas) ? linhas : []).map((l) => [l?.codigo, l]));
  overridesAtuais = [];
  for (const [codigo, base] of Object.entries(PLANOS_BASE)) {
    const o = porCodigo.get(codigo);
    const preco = Number(o?.precoMensal);
    if (!o || !Number.isFinite(preco) || preco <= 0) {
      PLANOS[codigo] = base;
      continue;
    }
    overridesAtuais.push(codigo);
    PLANOS[codigo] = Object.freeze({
      ...base,
      precoMensal: Math.round(preco * 100) / 100,
      limites: Object.freeze({ ...base.limites, ...limitesValidos(o.limites) }),
    });
  }
  return PLANOS;
}
aplicarOverrides([]);

/** Codigos com preco/limite vindos do banco (pro admin mostrar "editado"). */
function planosPersonalizados() {
  return [...overridesAtuais];
}

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
  PLANOS_BASE,
  aplicarOverrides,
  planosPersonalizados,
  PLANO_DO_TRIAL,
  DIAS_DE_TRIAL,
  DESCONTO_ANUAL,
  RECURSOS,
  LIMITES,
  ILIMITADO,
  obterPlano,
  planosPublicos,
};

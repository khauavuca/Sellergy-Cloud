// =====================================================================
// REGRAS PURAS DO FINANCEIRO (sem banco) — testadas em regras.test.js
// =====================================================================
// Datas: o front manda "YYYY-MM-DD" (campo date). Antes isso virava
// meia-noite UTC = 21h do dia anterior em Brasilia, e o vencimento
// aparecia 1 dia antes (e "atrasado"). Agora:
//   - data de vencimento/pagamento "YYYY-MM-DD" -> 12:00 UTC (09h em
//     Brasilia). O dia e o mesmo em qualquer fuso de -11h a +11h.
//   - filtro de periodo "YYYY-MM-DD" -> 00:00 a 23:59:59.999 de Brasilia.
// =====================================================================

const { paraNumero, lerDinheiro, lerInteiro } = require('../utils/numero');

const DIA_MS = 24 * 60 * 60 * 1000;
const OFFSET_BRT_H = 3; // Brasilia = UTC-3 (sem horario de verao)
const ANO_MIN = 1900;
const ANO_MAX = 2100;

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;

function diaValido(ano, mes, dia) {
  if (ano < ANO_MIN || ano > ANO_MAX) return false;
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return dia <= ultimo;
}

/**
 * Le uma data "de calendario" (vencimento, pagamento).
 * "YYYY-MM-DD" -> 12:00 UTC daquele dia. ISO completo -> o instante.
 * Recusa 31/02, ano fora de 1900..2100 e texto qualquer.
 */
function lerDataDia(valor, rotulo = 'Data') {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return { ok: false, erro: `${rotulo} inválida.` };
    const a = valor.getUTCFullYear();
    if (a < ANO_MIN || a > ANO_MAX) return { ok: false, erro: `${rotulo} fora do intervalo permitido.` };
    return { ok: true, data: valor };
  }
  if (typeof valor !== 'string') return { ok: false, erro: `${rotulo} inválida.` };
  const t = valor.trim();
  let m = RE_DIA.exec(t);
  if (m) {
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!diaValido(ano, mes, dia)) return { ok: false, erro: `${rotulo} inválida.` };
    return { ok: true, data: new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0, 0)) };
  }
  m = RE_ISO.exec(t);
  if (m) {
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const d = new Date(t);
    if (!diaValido(ano, mes, dia) || Number.isNaN(d.getTime())) return { ok: false, erro: `${rotulo} inválida.` };
    return { ok: true, data: d };
  }
  return { ok: false, erro: `${rotulo} inválida. Use o formato AAAA-MM-DD.` };
}

/**
 * Limite de filtro. "YYYY-MM-DD" vira o inicio (00:00) ou o fim
 * (23:59:59.999) do dia em Brasilia; ISO completo e usado como veio.
 * Vazio -> { ok: true, data: null }.
 */
function lerLimite(valor, lado, rotulo) {
  if (valor === undefined || valor === null || valor === '') return { ok: true, data: null };
  if (typeof valor !== 'string') return { ok: false, erro: `${rotulo} inválida.` };
  const t = valor.trim();
  const m = RE_DIA.exec(t);
  if (m) {
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!diaValido(ano, mes, dia)) return { ok: false, erro: `${rotulo} inválida.` };
    const inicio = Date.UTC(ano, mes - 1, dia, OFFSET_BRT_H, 0, 0, 0);
    return { ok: true, data: new Date(lado === 'fim' ? inicio + DIA_MS - 1 : inicio) };
  }
  const r = lerDataDia(t, rotulo);
  return r;
}

/**
 * Periodo de filtro { inicio, fim } vindo da query. Recusa data invalida e
 * inicio depois do fim. `padraoDias` preenche o inicio quando so vier o fim
 * (ou nada): ultimos N dias ate hoje (Brasilia).
 */
function lerPeriodo(query = {}, { padraoDias = null, agora = new Date() } = {}) {
  const ini = lerLimite(query.inicio, 'inicio', 'Data inicial');
  if (!ini.ok) return ini;
  const fim = lerLimite(query.fim, 'fim', 'Data final');
  if (!fim.ok) return fim;
  let inicio = ini.data;
  let final = fim.data;
  if (padraoDias != null) {
    if (!final) {
      const hojeBRT = new Date(agora.getTime() - OFFSET_BRT_H * 3600000);
      final = new Date(Date.UTC(hojeBRT.getUTCFullYear(), hojeBRT.getUTCMonth(), hojeBRT.getUTCDate(), OFFSET_BRT_H) + DIA_MS - 1);
    }
    if (!inicio) {
      const fimBRT = new Date(final.getTime() - OFFSET_BRT_H * 3600000);
      inicio = new Date(Date.UTC(fimBRT.getUTCFullYear(), fimBRT.getUTCMonth(), fimBRT.getUTCDate() - (padraoDias - 1), OFFSET_BRT_H));
    }
  }
  if (inicio && final && inicio > final) {
    return { ok: false, erro: 'A data inicial é depois da data final.' };
  }
  return { ok: true, inicio, fim: final };
}

/** Soma dias inteiros a uma data (mantem a hora). */
function somarDias(data, dias) {
  return new Date(new Date(data).getTime() + dias * DIA_MS);
}

/** Dia (YYYY-MM-DD) em Brasilia. */
function diaBRT(data) {
  return new Date(data).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Vencimento da parcela i (0 = a primeira): mesmo dia nos meses seguintes;
 * se o mes nao tem o dia (31 em abril), usa o ultimo dia. Opera em UTC.
 */
function vencimentoParcela(base, i) {
  const b = new Date(base);
  const ano = b.getUTCFullYear();
  const mes = b.getUTCMonth() + i;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dia = Math.min(b.getUTCDate(), ultimo);
  return new Date(Date.UTC(ano, mes, dia, b.getUTCHours(), b.getUTCMinutes(), b.getUTCSeconds(), b.getUTCMilliseconds()));
}

/** Divide um valor em n parcelas em centavos; a diferenca vai na ultima. */
function dividirParcelas(valor, n) {
  const centavos = Math.round(valor * 100);
  const base = Math.floor(centavos / n);
  const partes = Array.from({ length: n }, () => base);
  partes[n - 1] += centavos - base * n;
  return partes.map((c) => c / 100);
}

/** Texto obrigatorio/opcional com tamanho. */
function lerTexto(valor, { rotulo = 'Texto', min = 0, max = 120, obrigatorio = false } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (obrigatorio) return { ok: false, erro: `${rotulo} é obrigatório.` };
    return { ok: true, valor: null };
  }
  if (typeof valor !== 'string') return { ok: false, erro: `${rotulo} inválido.` };
  const t = valor.trim();
  if (!t) {
    if (obrigatorio) return { ok: false, erro: `${rotulo} é obrigatório.` };
    return { ok: true, valor: null };
  }
  if (t.length < min) return { ok: false, erro: `${rotulo} precisa ter pelo menos ${min} caracteres.` };
  if (t.length > max) return { ok: false, erro: `${rotulo} pode ter no máximo ${max} caracteres.` };
  return { ok: true, valor: t };
}

// ---------------------------------------------------------------------
// Status de lancamento
// ---------------------------------------------------------------------
const STATUS_MANUAIS = ['PENDENTE', 'PAGO', 'CANCELADO'];

/**
 * Transicao permitida pelo PATCH de status. Cancelar tem rota propria
 * (pede motivo). Regras:
 *   PENDENTE -> PAGO
 *   PAGO -> PENDENTE (limpa a data de pagamento)
 *   CANCELADO -> PENDENTE (reabrir; limpa cancelamento)
 *   CANCELADO -> PAGO: nao (reabra antes)
 */
function validarTransicaoStatus(atual, novo) {
  if (novo === 'ATRASADO') {
    return { ok: false, erro: '"Atrasado" é calculado automaticamente (vencimento passado e não pago). Não pode ser escolhido.' };
  }
  if (!STATUS_MANUAIS.includes(novo)) return { ok: false, erro: 'Situação inválida. Use PENDENTE ou PAGO.' };
  if (novo === 'CANCELADO') {
    return { ok: false, erro: 'Para cancelar, use "Cancelar com motivo".' };
  }
  if (atual === novo) return { ok: true, semMudanca: true };
  if (atual === 'CANCELADO' && novo === 'PAGO') {
    return { ok: false, erro: 'Lançamento cancelado não pode ser pago. Reabra (volte para pendente) antes.' };
  }
  return { ok: true };
}

/** Cancelamento: so de PENDENTE, com motivo de 3 a 500 caracteres. */
function validarCancelamento(atual, motivo) {
  if (atual === 'CANCELADO') return { ok: false, erro: 'Este lançamento já está cancelado.', status: 409 };
  if (atual === 'PAGO') return { ok: false, erro: 'Lançamento pago não pode ser cancelado. Volte para pendente antes, se o pagamento não aconteceu.', status: 422 };
  const m = lerTexto(motivo, { rotulo: 'Motivo do cancelamento', min: 3, max: 500, obrigatorio: true });
  if (!m.ok) return { ok: false, erro: m.erro, status: 422 };
  return { ok: true, motivo: m.valor };
}

/** "Adiar": dias inteiros de 1 a 365, so em PENDENTE. */
function validarAdiamento(status, dias) {
  if (status !== 'PENDENTE') {
    return { ok: false, erro: 'Só dá para adiar lançamento pendente.', status: 409 };
  }
  const d = lerInteiro(dias === undefined ? 3 : dias, { min: 1, max: 365 });
  if (!d.ok) return { ok: false, erro: `Dias para adiar: ${d.erro}`, status: 422 };
  return { ok: true, dias: d.valor };
}

/** Parcelas: inteiro de 1 a 60. */
function lerParcelas(valor) {
  if (valor === undefined || valor === null || valor === '') return { ok: true, valor: 1 };
  const r = lerInteiro(valor, { min: 1, max: 60 });
  if (!r.ok) return { ok: false, erro: `Parcelas: ${r.erro}` };
  return r;
}

/**
 * Mes fechado (contabil): lancamento PAGO com pagamento (ou vencimento)
 * em mes anterior ao atual, em Brasilia.
 */
function ehMesFechado(lanc, agora = new Date()) {
  if (!lanc || lanc.status !== 'PAGO') return false;
  const ref = lanc.dataPagamento || lanc.dataVencimento;
  if (!ref) return false;
  return diaBRT(ref).slice(0, 7) < diaBRT(agora).slice(0, 7);
}

/** Uma data de pagamento cai em mes anterior ao atual (Brasilia)? */
function dataEmMesFechado(data, agora = new Date()) {
  return diaBRT(data).slice(0, 7) < diaBRT(agora).slice(0, 7);
}

/**
 * Indice de eficacia de cobranca: das receitas que venceram nos ultimos
 * 7 dias (nao canceladas), quantas ja estao pagas. Sempre 0..100.
 */
function indiceEficacia(pagas, vencidas) {
  if (!vencidas || vencidas <= 0) return 0;
  const p = Math.min(Math.max(0, pagas), vencidas);
  return Number(((p / vencidas) * 100).toFixed(2));
}

// ---------------------------------------------------------------------
// Conta a pagar
// ---------------------------------------------------------------------
const PERIODICIDADES = ['PONTUAL', 'MENSAL', 'ANUAL'];

/** Le dia/mes/periodicidade. `parcial` = edicao (so valida o que veio). */
function validarAgendaConta({ periodicidade, diaVencimento, mesVencimento }, { parcial = false } = {}) {
  const saida = {};
  if (periodicidade !== undefined || !parcial) {
    const p = periodicidade === undefined || periodicidade === null || periodicidade === '' ? 'MENSAL' : periodicidade;
    if (!PERIODICIDADES.includes(p)) return { ok: false, erro: 'Periodicidade inválida. Use PONTUAL, MENSAL ou ANUAL.', campo: 'periodicidade' };
    saida.periodicidade = p;
  }
  if (diaVencimento !== undefined) {
    if (diaVencimento === null || diaVencimento === '') saida.diaVencimento = null;
    else {
      const d = lerInteiro(diaVencimento, { min: 1, max: 31 });
      if (!d.ok) return { ok: false, erro: 'Dia do vencimento deve ser de 1 a 31.', campo: 'diaVencimento' };
      saida.diaVencimento = d.valor;
    }
  }
  if (mesVencimento !== undefined) {
    if (mesVencimento === null || mesVencimento === '') saida.mesVencimento = null;
    else {
      const m = lerInteiro(mesVencimento, { min: 1, max: 12 });
      if (!m.ok) return { ok: false, erro: 'Mês do vencimento deve ser de 1 a 12.', campo: 'mesVencimento' };
      saida.mesVencimento = m.valor;
    }
  }
  return { ok: true, valores: saida };
}

// ---------------------------------------------------------------------
// Caixa
// ---------------------------------------------------------------------
/** Retirada maior que o saldo esperado so com confirmacao explicita. */
function checarRetirada(valor, saldoEsperado, confirmado) {
  const sobra = Math.round((saldoEsperado - valor) * 100) / 100;
  if (sobra >= 0 || confirmado === true) return { ok: true, saldoDepois: sobra };
  return {
    ok: false,
    erro: `A retirada (${brl(valor)}) é maior que o saldo do caixa (${brl(saldoEsperado)}). Confirme se o caixa vai ficar negativo.`,
    codigo: 'SALDO_INSUFICIENTE',
    saldoDepois: sobra,
  };
}

const LIMITE_DIFERENCA_SEM_OBS = 10;

/** Fechamento com diferenca acima do limite exige observacao. */
function checarFechamento(diferenca, observacao) {
  if (Math.abs(diferenca) > LIMITE_DIFERENCA_SEM_OBS && !(typeof observacao === 'string' && observacao.trim().length >= 3)) {
    return {
      ok: false,
      erro: `Diferença de ${brl(Math.abs(diferenca))} no caixa. Escreva uma observação explicando (mínimo 3 caracteres).`,
      codigo: 'OBSERVACAO_OBRIGATORIA',
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// Relatorios
// ---------------------------------------------------------------------
/**
 * Reparte um total entre itens proporcional ao peso (qtd x preco). Garante
 * que a soma das partes = total (centavos). Pesos todos zero -> divide igual.
 */
function repartirPorPeso(total, pesos) {
  const n = pesos.length;
  if (n === 0) return [];
  const centavos = Math.round(total * 100);
  const soma = pesos.reduce((s, p) => s + (p > 0 ? p : 0), 0);
  const base = soma > 0 ? pesos.map((p) => (p > 0 ? p : 0) / soma) : pesos.map(() => 1 / n);
  const partes = base.map((f) => Math.floor(centavos * f));
  let resto = centavos - partes.reduce((s, c) => s + c, 0);
  for (let i = 0; resto > 0; i = (i + 1) % n, resto--) partes[i] += 1;
  return partes.map((c) => c / 100);
}

/** Fechamento mensal: so mes que ja terminou e ano >= 2000. */
function validarMesFechamento(ano, mes, agora = new Date()) {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return { ok: false, erro: 'Ano ou mês inválido.' };
  }
  if (ano < 2000) return { ok: false, erro: 'Ano inválido.' };
  const atual = diaBRT(agora).slice(0, 7);
  const pedido = `${ano}-${String(mes).padStart(2, '0')}`;
  if (pedido >= atual) return { ok: false, erro: 'Só dá para fechar um mês que já terminou.' };
  return { ok: true };
}

/** "YYYY-MM" seguinte. */
function proximaCompetencia(competencia) {
  const [a, m] = competencia.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}

function brl(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

module.exports = {
  ANO_MIN, ANO_MAX, DIA_MS, LIMITE_DIFERENCA_SEM_OBS,
  paraNumero, lerDinheiro, lerInteiro,
  lerDataDia, lerLimite, lerPeriodo, somarDias, diaBRT, vencimentoParcela, dividirParcelas, lerTexto,
  validarTransicaoStatus, validarCancelamento, validarAdiamento, lerParcelas, ehMesFechado, dataEmMesFechado,
  indiceEficacia, validarAgendaConta, checarRetirada, checarFechamento, repartirPorPeso,
  validarMesFechamento, proximaCompetencia, brl,
};

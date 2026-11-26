// Ajudantes puros da agenda (fase 2): fuso de Brasilia, dinheiro, nomes.
// Nada aqui toca o banco — da pra testar com node --test.

const FUSO = 'America/Sao_Paulo';

const fmtPartes = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
});
const DIA_SEMANA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Partes da data no horario de Brasilia (independe do TZ do processo). */
function partesBRT(data) {
  const d = data instanceof Date ? data : new Date(data);
  const p = Object.fromEntries(fmtPartes.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${p.hour}:${p.minute}`,
    minutos: Number(p.hour) * 60 + Number(p.minute),
    diaSemana: DIA_SEMANA[p.weekday],
    ano: Number(p.year),
    mes: Number(p.month),
  };
}

/** "2026-11" — mes de competencia (comissao) no horario de Brasilia. */
function competenciaBRT(data = new Date()) {
  return partesBRT(data).ymd.slice(0, 7);
}

/** Inicio e fim (exclusivo) de uma competencia "YYYY-MM" em Brasilia (UTC-3 fixo). */
function intervaloCompetencia(competencia) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ''));
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  const inicio = new Date(Date.UTC(ano, mes - 1, 1, 3, 0, 0));
  const fim = new Date(Date.UTC(mes === 12 ? ano + 1 : ano, mes === 12 ? 0 : mes, 1, 3, 0, 0));
  return { inicio, fim };
}

function minutosDeHora(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function brl(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "quarta, 25/11 às 13:30" no horario de Brasilia. */
function diaHoraTexto(data) {
  const d = new Date(data);
  const dia = d.toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'long', day: '2-digit', month: '2-digit' });
  return `${dia} às ${partesBRT(d).hhmm}`;
}

function horaTexto(data) {
  return partesBRT(data).hhmm;
}

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

/**
 * Nome-base do servico pra comparar fila x vaga. O agendamento guarda texto
 * ("Peeling - Rosto", "Peeling — Rosto" ou "Peeling"); a fila guarda o nome do
 * produto. Compara so o nome do produto, sem acento e sem caixa.
 */
function servicoBase(texto) {
  return String(texto || '')
    .split(/\s+[-—]\s+/)[0]
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase();
}

function digitos(tel) {
  return String(tel || '').replace(/\D/g, '');
}

/**
 * Telefone brasileiro com DDD, so digitos, sem o 55 e sem zero na frente.
 * Celular antigo sem o 9 (DDD + 8) vira a forma com 9 quando o numero e de
 * celular (comeca com 6-9), pra "11 9999-0001" e "11 99999-0001" casarem.
 * Sem DDD (8/9 digitos) ou tamanho estranho -> null (nao da pra comparar).
 */
function telefoneComDDD(tel) {
  let d = digitos(tel).replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d;
}

/**
 * Mesmo telefone = mesmo numero COMPLETO com DDD. Antes comparava so os 8
 * ultimos digitos e um numero de outro DDD virava a cliente errada (e gastava
 * o pacote dela).
 */
function mesmoTelefone(a, b) {
  const x = telefoneComDDD(a);
  return !!x && x === telefoneComDDD(b);
}

// ---------------------------------------------------------------------
// Validacoes de entrada da agenda (puras)
// ---------------------------------------------------------------------

const ANO_MIN = 1900;
const ANO_MAX = 2100;

/**
 * Data/hora vinda da tela. Recusa texto, 31/02 (o JS "rola" pra 03/03 calado),
 * ano < 1900 ou > 2100. Devolve { ok, valor: Date } ou { ok: false, erro }.
 */
function lerDataHora(valor) {
  if (valor instanceof Date) valor = valor.toISOString();
  if (typeof valor !== 'string' || !valor.trim()) return { ok: false, erro: 'Informe a data e a hora.' };
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (!m) return { ok: false, erro: 'Data inválida.' };
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const conf = new Date(Date.UTC(ano, mes - 1, dia));
  if (conf.getUTCFullYear() !== ano || conf.getUTCMonth() !== mes - 1 || conf.getUTCDate() !== dia) {
    return { ok: false, erro: 'Data inválida.' };
  }
  if (ano < ANO_MIN || ano > ANO_MAX) return { ok: false, erro: `Use um ano entre ${ANO_MIN} e ${ANO_MAX}.` };
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return { ok: false, erro: 'Data inválida.' };
  return { ok: true, valor: d };
}

/** Texto opcional: trim, ate `max`. null/'' -> null. Tipo errado -> erro. */
function lerTexto(valor, { max = 120, obrigatorio = false, rotulo = 'Campo' } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    return obrigatorio ? { ok: false, erro: `${rotulo} é obrigatório.` } : { ok: true, valor: null };
  }
  if (typeof valor !== 'string') return { ok: false, erro: `${rotulo} inválido.` };
  const t = valor.trim();
  if (!t) return obrigatorio ? { ok: false, erro: `${rotulo} é obrigatório.` } : { ok: true, valor: null };
  if (t.length > max) return { ok: false, erro: `${rotulo} pode ter no máximo ${max} caracteres.` };
  return { ok: true, valor: t };
}

/**
 * Jornada do profissional: { "1": [{ inicio: "08:00", fim: "12:00" }], ... }
 * com dias 1=segunda .. 7=domingo. null = segue o expediente do negocio.
 * Recusa array, texto, hora 25:00, fim antes do inicio e blocos sobrepostos.
 */
function validarJornada(jornada) {
  if (jornada === null || jornada === undefined || jornada === '') return { ok: true, valor: null };
  if (typeof jornada !== 'object' || Array.isArray(jornada)) return { ok: false, erro: 'Jornada inválida.' };
  const saida = {};
  for (const [chave, blocos] of Object.entries(jornada)) {
    if (!/^[1-7]$/.test(chave)) return { ok: false, erro: 'Jornada inválida: use os dias de 1 (segunda) a 7 (domingo).' };
    if (!Array.isArray(blocos) || blocos.length > 6) return { ok: false, erro: 'Jornada inválida.' };
    const lista = [];
    for (const b of blocos) {
      const ini = minutosDeHora(b?.inicio);
      const fim = minutosDeHora(b?.fim);
      if (ini == null || fim == null) return { ok: false, erro: 'Jornada com horário inválido (use HH:MM, de 00:00 a 23:59).' };
      if (fim <= ini) return { ok: false, erro: 'Na jornada, o fim precisa ser depois do início.' };
      lista.push({ inicio: String(b.inicio).trim().padStart(5, '0'), fim: String(b.fim).trim().padStart(5, '0'), ini, fimMin: fim });
    }
    lista.sort((a, b) => a.ini - b.ini);
    for (let i = 1; i < lista.length; i++) {
      if (lista[i].ini < lista[i - 1].fimMin) return { ok: false, erro: 'Na jornada, os horários do mesmo dia estão sobrepostos.' };
    }
    saida[chave] = lista.map(({ inicio, fim }) => ({ inicio, fim }));
  }
  return { ok: true, valor: saida };
}

/**
 * Avisos de um horario manual: passado e fora do expediente (jornada do
 * profissional, ou horario de funcionamento do negocio). Pura.
 * Dias: jornada 1=seg..7=dom; horarioFuncionamento.dias 0=dom..6=sab.
 * @returns {string[]} textos para a tela (vazio = sem aviso)
 */
function avisosDoHorario({ inicio, duracao, jornada = null, horarioFuncionamento = null, agora = new Date() }) {
  const avisos = [];
  const ini = new Date(inicio);
  if (ini.getTime() < agora.getTime()) avisos.push('Esse horário já passou.');
  const p = partesBRT(ini);
  const fimMin = p.minutos + (Number(duracao) || 30);
  let janelas = null;
  if (jornada && typeof jornada === 'object' && !Array.isArray(jornada)) {
    const iso = p.diaSemana === 0 ? 7 : p.diaSemana;
    const blocos = Array.isArray(jornada[String(iso)]) ? jornada[String(iso)] : [];
    janelas = blocos.map((b) => [minutosDeHora(b?.inicio), minutosDeHora(b?.fim)]).filter(([a, b]) => a != null && b != null && b > a);
  } else if (horarioFuncionamento && typeof horarioFuncionamento === 'object') {
    const dias = Array.isArray(horarioFuncionamento.dias) ? horarioFuncionamento.dias : [1, 2, 3, 4, 5, 6];
    const a = minutosDeHora(horarioFuncionamento.abertura) ?? 8 * 60;
    const b = minutosDeHora(horarioFuncionamento.fechamento) ?? 18 * 60;
    janelas = dias.includes(p.diaSemana) && b > a ? [[a, b]] : [];
  }
  if (janelas) {
    if (janelas.length === 0) avisos.push('Nesse dia não tem expediente.');
    else if (!janelas.some(([a, b]) => p.minutos >= a && fimMin <= b)) avisos.push('Esse horário fica fora do expediente.');
  }
  return avisos;
}

module.exports = {
  FUSO, partesBRT, competenciaBRT, intervaloCompetencia, minutosDeHora,
  round2, brl, diaHoraTexto, horaTexto, primeiroNome, servicoBase, digitos, mesmoTelefone,
  telefoneComDDD, lerDataHora, lerTexto, validarJornada, avisosDoHorario,
};

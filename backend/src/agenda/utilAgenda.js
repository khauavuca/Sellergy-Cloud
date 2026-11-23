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

function mesmoTelefone(a, b) {
  const x = digitos(a).slice(-8);
  const y = digitos(b).slice(-8);
  return x.length === 8 && x === y;
}

module.exports = {
  FUSO, partesBRT, competenciaBRT, intervaloCompetencia, minutosDeHora,
  round2, brl, diaHoraTexto, horaTexto, primeiroNome, servicoBase, digitos, mesmoTelefone,
};

// Contas pequenas de Meu plano (só essa tela usa).

const DESCONTO_ANUAL = 0.2;
// Mesma regra do backend (assinatura/situacao.js): fatura vencida há 10 dias
// deixa a conta só para consulta.
export const DIAS_ATE_SUSPENDER = 10;
const DIA_MS = 24 * 60 * 60 * 1000;

const arred = (v) => Math.round(v * 100) / 100;

/** Valor por mês no ciclo anual (o catálogo já manda; senão aplica 20%). */
export function anualMensal(p) {
  return Number.isFinite(Number(p?.precoAnualMensal)) && p?.precoAnualMensal !== null
    ? Number(p.precoAnualMensal)
    : arred(Number(p?.precoMensal || 0) * (1 - DESCONTO_ANUAL));
}

export const anualTotal = (p) => arred(anualMensal(p) * 12);

export const num = (v) => Number(v || 0).toLocaleString('pt-BR');

/** Limite numérico do plano (null/undefined = ilimitado). */
export const temLimite = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

/** Faturas em atraso/aberto e quantos dias a mais antiga está vencida. */
export function situacaoFaturas(faturas, agora = new Date()) {
  const vencidas = faturas.filter((f) => f.status === 'VENCIDA');
  const abertas = faturas.filter((f) => f.status === 'ABERTA');
  const maisAntiga = vencidas
    .map((f) => new Date(f.vencimento))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((x, y) => x - y)[0] || null;
  const diasAtraso = maisAntiga ? Math.max(0, Math.floor((agora.getTime() - maisAntiga.getTime()) / DIA_MS)) : null;
  const viraConsultaEm = maisAntiga ? new Date(maisAntiga.getTime() + DIAS_ATE_SUSPENDER * DIA_MS) : null;
  // A fatura pra pagar primeiro: a vencida mais antiga; senão a aberta mais próxima.
  const pagarPrimeiro = [...vencidas].sort((x, y) => new Date(x.vencimento) - new Date(y.vencimento))[0]
    || [...abertas].sort((x, y) => new Date(x.vencimento) - new Date(y.vencimento))[0]
    || null;
  const valorVencido = vencidas.reduce((s, f) => s + Number(f.valor || 0), 0);
  return { vencidas, abertas, diasAtraso, viraConsultaEm, pagarPrimeiro, valorVencido };
}

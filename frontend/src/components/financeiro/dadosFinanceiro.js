// Helpers de dados da tela Financeiro (sem componentes React).
import api from '../../services/api';

export const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DIA_MS = 24 * 60 * 60 * 1000;

function meiaNoite(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Dias entre hoje e a data (negativo = já passou). */
export function diasAte(data) {
  return Math.round((meiaNoite(data) - meiaNoite(new Date())) / DIA_MS);
}

/** "hoje", "ontem", "amanhã", "seg" (até 6 dias) ou dd/mm. */
export function rotuloDia(data) {
  const d = diasAte(data);
  if (d === 0) return 'hoje';
  if (d === -1) return 'ontem';
  if (d === 1) return 'amanhã';
  if (d > 1 && d < 7) return new Date(data).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return new Date(data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Variante do Badge conforme o vencimento de algo em aberto. */
export function tomVencimento(data) {
  const d = diasAte(data);
  if (d < 0) return 'danger';
  if (d <= 7) return 'warning';
  return 'neutral';
}

/** Intervalo do mês atual (ISO) pra filtrar por vencimento. */
export function intervaloMesAtual() {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);
  return { inicio: inicio.toISOString(), fim: fim.toISOString(), diasNoMes: fim.getDate() };
}

/**
 * Busca todos os lançamentos de um filtro (o backend limita 100 por página).
 * Para em 10 páginas pra não pesar.
 */
export async function buscarTodosLancamentos(params) {
  const todos = [];
  for (let pagina = 1; pagina <= 10; pagina += 1) {
    const r = await api.get('/financeiro/lancamentos', { params: { ...params, limite: 100, pagina } });
    const dados = r.data?.dados || (Array.isArray(r.data) ? r.data : []);
    todos.push(...dados);
    const paginas = r.data?.paginacao?.paginas || 1;
    if (pagina >= paginas) break;
  }
  return todos;
}

/** Soma entrou/saiu (pagos) por semana do mês, pelo vencimento. */
export function semanasDoMes(lancamentosMes, diasNoMes) {
  const qtd = Math.ceil(diasNoMes / 7);
  const semanas = Array.from({ length: qtd }, (_, i) => ({ nome: `${i + 1}ª semana`, entrou: 0, saiu: 0 }));
  lancamentosMes.forEach((l) => {
    if (l.status !== 'PAGO') return;
    const dia = new Date(l.dataVencimento).getDate();
    const s = semanas[Math.min(qtd - 1, Math.floor((dia - 1) / 7))];
    if (l.tipo === 'RECEITA') s.entrou += Number(l.valor) || 0;
    else s.saiu += Number(l.valor) || 0;
  });
  return semanas;
}

/** Despesas pagas do mês agrupadas por categoria (maiores primeiro). */
export function despesasPorCategoria(lancamentosMes, max = 5) {
  const mapa = new Map();
  lancamentosMes.forEach((l) => {
    if (l.tipo !== 'DESPESA' || l.status !== 'PAGO') return;
    const nome = l.categoria?.nome || 'Sem categoria';
    mapa.set(nome, (mapa.get(nome) || 0) + (Number(l.valor) || 0));
  });
  const lista = [...mapa.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
  if (lista.length <= max) return lista;
  const resto = lista.slice(max - 1).reduce((s, x) => s + x.valor, 0);
  return [...lista.slice(0, max - 1), { nome: 'Outras categorias', valor: resto }];
}

/** Pendências de despesa que vencem em até 7 dias (inclui atrasadas). */
export function filtrarProximos7(pendentes) {
  return pendentes
    .filter((l) => diasAte(l.dataVencimento) <= 7)
    .sort((a, b) => new Date(a.dataVencimento) - new Date(b.dataVencimento));
}

export const METODO_LABEL = {
  PIX: 'Pix',
  DINHEIRO: 'Dinheiro',
  CARTAO_DEBITO: 'Débito',
  CARTAO_CREDITO: 'Crédito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
};

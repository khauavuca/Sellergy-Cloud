// Utilitários compartilhados entre a página da Agenda e os componentes dela.

export const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtHora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const STATUS_LABELS = {
  PENDING: { label: 'Pendente', variant: 'warning' },
  CONFIRMED: { label: 'Confirmado', variant: 'success' },
  CANCELED: { label: 'Cancelado', variant: 'danger' },
  COMPLETED: { label: 'Concluído', variant: 'info' },
};

// Cores por status. soft = fundo do bloco; text = cor do texto; solid = barra
// lateral mais saturada. Mesmas variáveis usadas no Badge (tema claro/escuro).
const STATUS_CORES = {
  PENDING:   { soft: 'var(--warning-soft)', text: 'var(--warning-text)', solid: 'var(--warning)' },
  CONFIRMED: { soft: 'var(--success-soft)', text: 'var(--success-text)', solid: 'var(--success)' },
  CANCELED:  { soft: 'var(--danger-soft)',  text: 'var(--danger-text)',  solid: 'var(--danger)'  },
  COMPLETED: { soft: 'var(--info-soft)',    text: 'var(--info-text)',    solid: 'var(--info)'    },
};
export const coresPorStatus = (s) => STATUS_CORES[s] || STATUS_CORES.PENDING;

export const SINAL_LABELS = {
  PAGO: { label: 'Pago', variant: 'success' },
  PENDENTE: { label: 'Pendente', variant: 'warning' },
  EXPIRADO: { label: 'Não pago no prazo', variant: 'neutral' },
  CANCELADO: { label: 'Cancelado', variant: 'neutral' },
  DEVOLVIDO: { label: 'Devolvido', variant: 'neutral' },
};

// Regra de imutabilidade (espelha o backend em agenda.routes.js):
// agendamento passado + status != PENDING fica travado pra editar/excluir.
// PENDING passado continua editável pra atualizar o status retroativamente
// (ex.: marcar como Concluído). Assim que atualiza, trava.
export function ehAgendamentoImutavel(ag) {
  if (!ag) return false;
  if (ag.status === 'PENDING') return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return new Date(ag.data) < hoje;
}

export function iniciais(nome = '') {
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  return ((partes[0][0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

/** Domingo 00:00 da semana que contém a data. */
export function inicioDaSemana(data) {
  const d = new Date(data);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Janela [inicio, fim] no fuso LOCAL do navegador para cada visão. A Lista usa
 * a mesma janela da Semana.
 */
export function intervaloDaVisao(view, dataAtual) {
  if (view === 'dia') {
    const inicio = new Date(dataAtual);
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(dataAtual);
    fim.setHours(23, 59, 59, 999);
    return { inicio, fim };
  }
  if (view === 'semana' || view === 'lista') {
    const inicio = inicioDaSemana(dataAtual);
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    fim.setHours(23, 59, 59, 999);
    return { inicio, fim };
  }
  return {
    inicio: new Date(dataAtual.getFullYear(), dataAtual.getMonth(), 1, 0, 0, 0, 0),
    fim: new Date(dataAtual.getFullYear(), dataAtual.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

/** Telefone só com dígitos, com DDI 55 para link do WhatsApp. */
export function linkWhatsApp(telefone) {
  const dig = String(telefone || '').replace(/\D/g, '');
  if (dig.length < 10) return null;
  return `https://wa.me/${dig.length <= 11 ? `55${dig}` : dig}`;
}

import { Clock, Star, UserX, Users } from 'lucide-react';

export const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtData = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
export const fmtNum = (n) => Number(n ?? 0).toLocaleString('pt-BR');

export const STATUS_CAMPANHA_VARIANT = {
  RASCUNHO: 'neutral', ENVIANDO: 'warning', CONCLUIDA: 'success', ERRO: 'danger',
};
export const STATUS_CAMPANHA_LABEL = {
  RASCUNHO: 'Rascunho', ENVIANDO: 'Enviando', CONCLUIDA: 'Concluída', ERRO: 'Erro',
};

export const FORM_CAMPANHA_VAZIO = {
  nome: '', segmento: 'recompra', dias: '30', mensagem: '', nomeTemplate: '',
  incluirCupom: false, cupomCodigo: '', cupomTipo: 'PERCENTUAL', cupomValor: '', cupomValidoAte: '', cupomUsoMaximo: '',
};

export const JANELAS = [
  { value: '30', label: 'Compraram há 30+ dias' },
  { value: '45', label: 'Compraram há 45+ dias' },
  { value: '60', label: 'Compraram há 60+ dias' },
  { value: '90', label: 'Compraram há 90+ dias' },
];

export const SEGMENTOS = [
  {
    valor: 'recompra',
    label: 'Sumiram após comprar',
    icon: Clock,
    criterio: 'Uma compra e não voltaram',
    aviso: 'Compraram ou agendaram uma vez e não voltaram na janela escolhida. Envio ainda é manual, um a um.',
  },
  {
    valor: 'recorrentes',
    label: 'Recorrentes',
    icon: Star,
    criterio: '2 vezes ou mais',
    aviso: 'Já compraram ou agendaram 2 vezes ou mais — bons candidatos pra fidelidade ou indicação.',
  },
  {
    valor: 'nunca-converteram',
    label: 'Nunca converteram',
    icon: UserX,
    criterio: 'Entraram há 7+ dias',
    aviso: 'Entraram na base há 7 dias ou mais e nunca fecharam compra nem atendimento. Vale retomar contato.',
  },
  {
    valor: 'convertidos',
    label: 'Já converteram',
    icon: Users,
    criterio: 'Compraram ou foram atendidos',
    aviso: 'Todo lead que já comprou ou foi atendido pelo menos uma vez — sua base de clientes reais.',
  },
];

/** Texto curto do cupom: "VOLTA10 · 10%" ou "TERCA10 · R$ 10,00". */
export const textoCupom = (cupom) => {
  if (!cupom) return 'Sem cupom';
  const valor = cupom.tipo === 'PERCENTUAL' ? `${Number(cupom.valor)}%` : fmtBRL(cupom.valor);
  return `${cupom.codigo} · ${valor}`;
};

/** Contagem de leads de um segmento, usando os endpoints que já existem. */
export const urlSegmento = (seg, dias) =>
  seg === 'recompra' ? `/campanhas/recompra?dias=${encodeURIComponent(dias)}` : `/campanhas/${seg}`;

export const contarResposta = (seg, data) =>
  (seg === 'recompra' ? data?.candidatos?.length : data?.leads?.length) || 0;

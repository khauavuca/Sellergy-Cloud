import { Cake, Clock, Star, UserX, Users } from 'lucide-react';

export const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtData = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
export const fmtNum = (n) => Number(n ?? 0).toLocaleString('pt-BR');

export const STATUS_CAMPANHA_VARIANT = {
  RASCUNHO: 'neutral', AGENDADA: 'info', ENVIANDO: 'warning', CONCLUIDA: 'success', ERRO: 'danger',
};
export const STATUS_CAMPANHA_LABEL = {
  RASCUNHO: 'Rascunho', AGENDADA: 'Agendada', ENVIANDO: 'Enviando', CONCLUIDA: 'Concluída', ERRO: 'Erro',
};

/** Rascunho com data marcada aparece como "Agendada". */
export const statusVisivel = (c) => (c?.status === 'RASCUNHO' && c?.agendadoPara ? 'AGENDADA' : c?.status);

export const FORM_CAMPANHA_VAZIO = {
  objetivo: '', nome: '', segmento: 'recompra', dias: '30', gastoMinimo: '', mensagem: '', nomeTemplate: '',
  botao: 'MARCAR_HORARIO',
  incluirCupom: false, cupomCodigo: '', cupomTipo: 'PERCENTUAL', cupomValor: '', cupomValidoAte: '', cupomUsoMaximo: '',
  quando: 'agora', agendarData: '', agendarHora: '10:00',
};

// Tamanho máximo do texto (igual ao backend).
export const MAX_MENSAGEM = 1000;

/** Campos que trocam pelos dados de cada cliente (services/campanhaTexto.js). */
export const VARIAVEIS = ['[nome]', '[último serviço]', '[profissional]', '[cupom]', '[link de agendamento]'];

/** Botão da mensagem. "Ver horários" ficou de fora: o bot não responde com os horários livres. */
export const BOTOES_MENSAGEM = [
  { valor: 'MARCAR_HORARIO', titulo: 'Marcar horário', desc: 'Abre seu link de agendamento' },
  { valor: 'FALAR', titulo: 'Falar com a gente', desc: 'O cliente responde na conversa' },
];

/** 1º passo: cada objetivo pré-preenche o público e o texto. */
export const OBJETIVOS = [
  {
    valor: 'voltar',
    titulo: 'Chamar de volta quem sumiu',
    desc: 'Clientes sem comprar há 60 dias ou mais',
    preencher: { segmento: 'recompra', dias: '60', botao: 'MARCAR_HORARIO' },
    texto: 'Oi, [nome]! Faz um tempinho que você não vem e a gente sentiu sua falta. Seu [último serviço] com [profissional] está te esperando: toque abaixo e escolha o horário.',
  },
  {
    valor: 'aniversario',
    titulo: 'Parabéns com presente',
    desc: 'Aniversariantes do mês, com cupom',
    preencher: { segmento: 'aniversariantes', botao: 'MARCAR_HORARIO', incluirCupom: true },
    texto: 'Parabéns, [nome]! Pra comemorar seu mês, você ganha um presente: use o cupom [cupom] no próximo atendimento. Toque abaixo e escolha o horário.',
  },
  {
    valor: 'novidade',
    titulo: 'Avisar de novidade',
    desc: 'Serviço ou produto novo pra quem já é cliente',
    preencher: { segmento: 'convertidos', botao: 'FALAR' },
    texto: 'Oi, [nome]! Temos novidade por aqui e lembramos de você. Quer saber mais? É só responder esta mensagem.',
  },
  {
    valor: 'horario-vazio',
    titulo: 'Preencher horário vazio',
    desc: 'Promoção pra clientes fiéis em dias fracos',
    preencher: { segmento: 'recorrentes', botao: 'MARCAR_HORARIO' },
    texto: 'Oi, [nome]! Abrimos horários extras nesta semana. Quer garantir o seu? Toque abaixo e escolha o melhor horário.',
  },
];

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
    aviso: 'Compraram e não voltaram dentro da janela escolhida.',
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
  {
    valor: 'aniversariantes',
    label: 'Aniversariantes do mês',
    icon: Cake,
    criterio: 'Data de nascimento neste mês',
    aviso: 'Clientes com data de nascimento cadastrada que fazem aniversário neste mês.',
    // Só existe na criação de campanha (a lista "Segmentos prontos" não mostra).
    soCampanha: true,
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

/**
 * Prévia do texto com dados de exemplo (o envio usa os de cada cliente).
 * Mesmas trocas de services/campanhaTexto.js no backend.
 */
export const EXEMPLO_PREVIA = { nome: 'Maria', ultimoServico: 'corte', profissional: 'Ana' };
export const montarPrevia = (mensagem, { cupom, link } = {}) => String(mensagem || '')
  .replace(/\[nome\]/gi, EXEMPLO_PREVIA.nome)
  .replace(/\[[uú]ltimo servi[cç]o\]/gi, EXEMPLO_PREVIA.ultimoServico)
  .replace(/\[profissional\]/gi, EXEMPLO_PREVIA.profissional)
  .replace(/\[cupom\]/gi, cupom || '[cupom]')
  .replace(/\[link de agendamento\]/gi, link || '[link de agendamento]');

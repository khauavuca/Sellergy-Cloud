// Formatadores e rótulos da caixa de entrada do WhatsApp (tela /app/whatsapp).

/** "5562999990000" -> "(62) 99999-0000"; outro país fica "+<dígitos>". */
export function formatarTelefone(digitos) {
  const d = String(digitos || '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const n = d.slice(4);
    return n.length === 9 ? `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}` : `(${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`;
  }
  return d ? `+${d}` : '';
}

export function nomeDaConversa(c) {
  return c?.nome || formatarTelefone(c?.telefone) || 'Contato';
}

/** Iniciais pro avatar ("Renata Alves" -> "RA"). */
export function iniciais(nome) {
  const partes = String(nome || '').replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '#';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Hora curta da lista: "16:20", "ontem", "23/11". */
export function horaCurta(iso, agora = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (mesmoDia(d, agora)) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const ontem = new Date(agora); ontem.setDate(ontem.getDate() - 1);
  if (mesmoDia(d, ontem)) return 'ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function hora(iso) {
  return iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
}

/** Separador de dia entre as mensagens: "Hoje", "Ontem", "seg, 23/11". */
export function rotuloDia(iso, agora = new Date()) {
  const d = new Date(iso);
  if (mesmoDia(d, agora)) return 'Hoje';
  const ontem = new Date(agora); ontem.setDate(ontem.getDate() - 1);
  if (mesmoDia(d, ontem)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export function chaveDia(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Situação da conversa (vem calculada do backend). */
export const SITUACOES = {
  AGUARDANDO: { rotulo: 'Aguardando', variant: 'warning' },
  BOT: { rotulo: 'Bot', variant: 'info' },
  EQUIPE: { rotulo: 'Equipe', variant: 'neutral' },
};

/** Selo em cima da mensagem que não foi digitada por gente. */
export const ROTULO_ORIGEM = {
  BOT: 'Bot de atendimento',
  LEMBRETE: 'Lembrete automático',
  CAMPANHA: 'Campanha',
  SISTEMA: 'Mensagem automática',
};

export const ROTULO_STATUS = {
  PENDENTE: 'enviando…',
  SIMULADA: 'simulada',
  FALHOU: 'não enviada',
};

export const NOME_CANAL = { META_CLOUD: 'WhatsApp oficial', BAILEYS: 'número por QR Code' };

/** Rótulo do filtro da lista. */
export const FILTROS = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'nao-lidas', rotulo: 'Não lidas' },
  { valor: 'aguardando', rotulo: 'Aguardando' },
  { valor: 'equipe', rotulo: 'Equipe' },
  { valor: 'bot', rotulo: 'Bot' },
];

/** Repassa a resposta da API (ou o erro) num texto curto. */
export function erroDaApi(e, padrao) {
  return e?.response?.data?.erro || padrao;
}

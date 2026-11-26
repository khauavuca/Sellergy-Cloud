// Utilitarios das telas de pedidos, loja online e conta de recebimento.

export const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtHora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

export function fmtQuando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return `Hoje ${fmtHora(iso)}`;
  if (d.toDateString() === ontem.toDateString()) return `Ontem ${fmtHora(iso)}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${fmtHora(iso)}`;
}

export function mascaraTelefone(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function mascaraCpf(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function mascaraCnpj(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function mascaraCep(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export const STATUS_PEDIDO = {
  NOVO: { rotulo: 'Novo', variante: 'info' },
  AGUARDANDO_PAGAMENTO: { rotulo: 'Aguardando pagamento', variante: 'warning' },
  PAGO: { rotulo: 'Pago · separar', variante: 'success' },
  ENTREGUE: { rotulo: 'Entregue', variante: 'neutral' },
  CANCELADO: { rotulo: 'Cancelado', variante: 'danger' },
};

export const ORIGEM_PEDIDO = { CATALOGO: 'Loja online', WHATSAPP: 'WhatsApp', BALCAO: 'Balcão' };

export function resumoItens(itens, max = 2) {
  const lista = Array.isArray(itens) ? itens : [];
  const partes = lista.slice(0, max).map((i) => `${i.quantidade}× ${i.nome}`);
  return lista.length > max ? `${partes.join(', ')} +${lista.length - max}` : partes.join(', ');
}

/** Mensagem de erro da API (com fallback). */
export function erroDaApi(e, padrao = 'Não deu certo. Tente de novo.') {
  return e?.response?.data?.erro || e?.response?.data?.error || padrao;
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

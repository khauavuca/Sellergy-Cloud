// Rotulos e formatos da assinatura, compartilhados por Meu plano, o modal de
// planos e o painel admin de assinaturas.

export const NOME_PLANO = { BASIC: 'Essencial', PRO: 'Profissional', PREMIUM: 'Negócio' };

export const STATUS_ASSINATURA = {
  TRIAL: { rotulo: 'Em teste', variante: 'info' },
  ATIVA: { rotulo: 'Ativa', variante: 'success' },
  ATRASADA: { rotulo: 'Atrasada', variante: 'warning' },
  SUSPENSA: { rotulo: 'Suspensa', variante: 'danger' },
  CANCELADA: { rotulo: 'Cancelada', variante: 'neutral' },
};

export const STATUS_FATURA = {
  ABERTA: { rotulo: 'Em aberto', variante: 'info' },
  PAGA: { rotulo: 'Paga', variante: 'success' },
  VENCIDA: { rotulo: 'Vencida', variante: 'danger' },
  CANCELADA: { rotulo: 'Cancelada', variante: 'neutral' },
};

export const CICLO = { MENSAL: 'Mensal', ANUAL: 'Anual' };

export const FORMA_PAGAMENTO = {
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  BOLETO: 'Boleto',
  UNDEFINED: 'Escolher na hora de pagar',
};

export const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function dataCurta(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "2026-11" ou data -> "nov/2026". */
export function competencia(v) {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4})-(\d{2})/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace(' de ', '/').replace('.', '');
}

/** Mascara de CPF (11 digitos) ou CNPJ (14 digitos). */
export function mascararCpfCnpj(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

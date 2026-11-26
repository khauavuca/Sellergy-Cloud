import { useState, useCallback, useMemo } from 'react';
import { CheckCircle2, XCircle, AlertCircle, Info, X } from 'lucide-react';
import clsx from 'clsx';

import { ToastContext } from './useToast';

/**
 * Sistema de toast (o hook useToast e o contexto ficam em ./useToast).
 * Necessita <ToastProvider> no topo da arvore.
 */

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remover = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const adicionar = useCallback((mensagem, opcoes = {}) => {
    const id = ++idCounter;
    const tipo = opcoes.tipo || 'default';
    const duracao = opcoes.duracao ?? 4000;
    setToasts((prev) => [...prev, { id, mensagem, tipo }]);
    if (duracao > 0) setTimeout(() => remover(id), duracao);
    return id;
  }, [remover]);

  // Funcao chamavel com atalhos por tipo; montada uma vez por "adicionar"
  // (mesma identidade estavel de antes, sem mutar valor memoizado).
  const api = useMemo(() => Object.assign(
    (msg, op) => adicionar(msg, op),
    {
      success: (msg, op) => adicionar(msg, { ...op, tipo: 'success' }),
      error: (msg, op) => adicionar(msg, { ...op, tipo: 'error' }),
      warning: (msg, op) => adicionar(msg, { ...op, tipo: 'warning' }),
      info: (msg, op) => adicionar(msg, { ...op, tipo: 'info' }),
    },
  ), [adicionar]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remover(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }) {
  const tipos = {
    default: { Icon: Info, classe: 'bg-[var(--primary)] text-[var(--text-on-primary)]' },
    success: { Icon: CheckCircle2, classe: 'bg-[var(--primary)] text-[var(--text-on-primary)]' },
    error: { Icon: XCircle, classe: 'bg-[var(--danger)] text-white' },
    warning: { Icon: AlertCircle, classe: 'bg-[var(--warning)] text-white' },
    info: { Icon: Info, classe: 'bg-[var(--primary)] text-[var(--text-on-primary)]' },
  };

  const { Icon, classe } = tipos[toast.tipo] || tipos.default;
  const iconColor = toast.tipo === 'success' ? 'text-[#5DB17A]' : '';

  return (
    <div
      className={clsx(
        'pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl shadow-[var(--shadow-lg)] min-w-[300px] max-w-[480px]',
        'animate-in slide-in-from-top-2 fade-in duration-200',
        classe
      )}
    >
      <Icon size={18} className={clsx('flex-shrink-0', iconColor)} strokeWidth={2} />
      <span className="text-sm font-medium flex-1">{toast.mensagem}</span>
      <button
        onClick={onClose}
        className="opacity-60 hover:opacity-100 transition-opacity"
      >
        <X size={16} />
      </button>
    </div>
  );
}

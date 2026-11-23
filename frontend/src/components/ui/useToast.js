import { createContext, useContext } from 'react';

/**
 * Sistema de toast.
 * Uso:
 *   const toast = useToast();
 *   toast.success('Salvo com sucesso');
 *   toast.error('Falha ao carregar');
 *   toast('Mensagem neutra');
 *
 * Necessita <ToastProvider> (./Toast) no topo da arvore.
 */
export const ToastContext = createContext({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

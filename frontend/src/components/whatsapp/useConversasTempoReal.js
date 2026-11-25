import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

// Tempo real da caixa de entrada: entra na sala do negócio (o backend decide
// qual pelo usuário da sessão — o navegador não manda id nenhum) e repassa os
// eventos. Ver backend/src/conversas/tempoReal.js.
export function useConversasTempoReal({ ativo, onMensagem, onStatus, onConversa }) {
  const handlers = useRef({ onMensagem, onStatus, onConversa });
  useEffect(() => {
    handlers.current = { onMensagem, onStatus, onConversa };
  });

  useEffect(() => {
    if (!ativo) return undefined;
    const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:3333', {
      withCredentials: true,
      extraHeaders: { 'ngrok-skip-browser-warning': 'true' },
    });
    // Reentra a cada reconexão (a sala some quando o socket cai).
    socket.on('connect', () => socket.emit('join_conversas'));
    socket.on('conversa_mensagem', (d) => handlers.current.onMensagem?.(d));
    socket.on('conversa_mensagem_status', (d) => handlers.current.onStatus?.(d));
    socket.on('conversa_atualizada', (d) => handlers.current.onConversa?.(d));
    return () => socket.disconnect();
  }, [ativo]);
}

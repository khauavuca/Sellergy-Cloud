// Fila do suporte no painel admin: consulta /admin/suporte/resumo a cada 30 s
// e avisa a equipe quando chega chamado novo ou resposta de cliente
// (toast + contador no menu + "(n)" no titulo da aba). Sem isso o chamado so
// era visto quando alguem abria a tela de Suporte.
import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { useToast } from '../ui';

const INTERVALO_MS = 30_000;

export function useResumoSuporte(ativo) {
  const toast = useToast();
  const [resumo, setResumo] = useState(null);
  const anterior = useRef(null);

  useEffect(() => {
    if (!ativo) return undefined;
    let vivo = true;
    const buscar = () => api.get('/admin/suporte/resumo')
      .then((r) => {
        if (!vivo) return;
        const novo = r.data;
        const antes = anterior.current;
        if (antes && novo.naoLidos > antes.naoLidos) {
          const n = novo.naoLidos - antes.naoLidos;
          toast.info(n === 1 ? 'Chegou mensagem nova no suporte.' : `Chegaram ${n} mensagens novas no suporte.`);
        }
        anterior.current = novo;
        setResumo(novo);
      })
      .catch(() => { /* sem permissao ou rede fora: o menu so fica sem contador */ });
    buscar();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') buscar(); }, INTERVALO_MS);
    return () => { vivo = false; clearInterval(timer); };
  }, [ativo, toast]);

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = resumo?.naoLidos ? `(${resumo.naoLidos}) ${base}` : base;
  }, [resumo?.naoLidos]);

  return resumo;
}

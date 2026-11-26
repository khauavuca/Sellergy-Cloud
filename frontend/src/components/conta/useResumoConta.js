import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';

// Resumo da conta (plano, assinatura, assistente de inicio). Um cache de
// modulo evita buscar duas vezes quando o banner e o checklist montam juntos.
let cache = null;
let pendente = null;
const ouvintes = new Set();

async function buscar() {
  if (!pendente) {
    pendente = api.get('/conta/resumo')
      .then((r) => { cache = r.data; ouvintes.forEach((fn) => fn(cache)); return cache; })
      .finally(() => { pendente = null; });
  }
  return pendente;
}

export function useResumoConta() {
  const [resumo, setResumo] = useState(cache);

  useEffect(() => {
    ouvintes.add(setResumo);
    if (!cache) buscar().catch(() => {});
    return () => ouvintes.delete(setResumo);
  }, []);

  const recarregar = useCallback(() => buscar().catch(() => {}), []);
  return { resumo, recarregar };
}

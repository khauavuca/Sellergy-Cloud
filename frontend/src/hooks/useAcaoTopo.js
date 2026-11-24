import { createContext, useContext, useEffect } from 'react';

// Botão principal da tela no topo (ex.: "Nova venda"), como no mockup.
// O layout fornece o contexto; a página chama:
//
//   useAcaoTopo(<Button size="sm" icon={Plus} onClick={abrir}>Nova venda</Button>, [abrir]);
//
// Some sozinho quando a página sai da tela.
export const AcaoTopoContext = createContext(null);

export function useAcaoTopo(no, deps = []) {
  const definir = useContext(AcaoTopoContext);
  useEffect(() => {
    if (!definir) return undefined;
    definir(no);
    return () => definir(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definir, ...deps]);
}

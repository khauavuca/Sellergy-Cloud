import { useEffect, useRef, useState } from 'react';

/**
 * Diz quando o elemento entrou na tela (uma vez so). Sem IntersectionObserver,
 * ja comeca visivel: conteudo nunca fica escondido por falta de suporte.
 */
export function useVisivel({ margem = '0px 0px -12% 0px', limiar = 0.15 } = {}) {
  const ref = useRef(null);
  const [visivel, setVisivel] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = ref.current;
    if (!el || visivel) return undefined;
    const obs = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) {
          setVisivel(true);
          obs.disconnect();
        }
      },
      { rootMargin: margem, threshold: limiar },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visivel, margem, limiar]);

  return [ref, visivel];
}

/** Holofote verde que segue o mouse dentro do cartao (classe ld-holofote). */
export function moverHolofote(e) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

import { useVisivel } from './aoRolar';

/** Sobe e aparece quando entra na tela. `atraso` em ms para escalonar. */
export default function Revelar({ como: Tag = 'div', atraso = 0, className = '', style, children, ...resto }) {
  const [ref, visivel] = useVisivel();
  return (
    <Tag
      ref={ref}
      className={`ld-revelar ${visivel ? 'ld-visivel' : ''} ${className}`}
      style={{ '--ld-atraso': `${atraso}ms`, ...style }}
      {...resto}
    >
      {children}
    </Tag>
  );
}

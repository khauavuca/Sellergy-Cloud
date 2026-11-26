// Icones do prototipo (classe .i): 18px, traco 1.8, pontas arredondadas.
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

export function IconeCheck({ tamanho = 18, className = '' }) {
  return (
    <svg {...base} width={tamanho} height={tamanho} className={`shrink-0 ${className}`}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function IconeSeta({ tamanho = 18, className = '' }) {
  return (
    <svg {...base} width={tamanho} height={tamanho} className={`shrink-0 ${className}`}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

import { Link } from 'react-router-dom';
import { foco, titulo } from './estilo';

/** Marca leve (sem imagem): quadrado com "S" + nome. */
export default function Marca({ claro = false }) {
  return (
    <Link
      to="/"
      className={`inline-flex items-center gap-2.5 min-h-11 rounded-lg no-underline ${claro ? 'text-white' : 'text-[#15171A]'} ${foco}`}
      aria-label="Sellergy Cloud, página inicial"
    >
      <span
        aria-hidden="true"
        className={`${titulo} grid place-items-center w-[34px] h-[34px] rounded-[10px] bg-[#136F4D] text-white font-bold text-[19px]`}
      >
        S
      </span>
      <span aria-hidden="true" className={`${titulo} font-bold text-[20px]`}>
        Sellergy <span className={claro ? 'text-[#F2C46B]' : 'text-[#136F4D]'}>Cloud</span>
      </span>
    </Link>
  );
}

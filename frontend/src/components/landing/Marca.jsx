import { Link } from 'react-router-dom';
import { foco, titulo } from './estilo';

/** Marca oficial: o simbolo do Sellergy (o "S" em traco duplo) + o nome. */
export default function Marca({ claro = false }) {
  return (
    <Link
      to="/"
      className={`inline-flex items-center gap-2.5 min-h-11 rounded-lg no-underline ${claro ? 'text-white' : 'text-[#15171A]'} ${foco}`}
      aria-label="Sellergy Cloud, página inicial"
    >
      <img src="/logo-sellergy.png" alt="" aria-hidden="true" width="34" height="34" className="w-[34px] h-[34px] rounded-[10px]" />
      <span aria-hidden="true" className={`${titulo} font-bold text-[21px] tracking-[-0.02em]`}>
        Sellergy <span className={claro ? 'text-[#F2C46B]' : 'text-[#136F4D]'}>Cloud</span>
      </span>
    </Link>
  );
}

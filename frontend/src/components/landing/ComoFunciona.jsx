import { PASSOS } from './conteudo';
import { container, titulo, tituloSecao } from './estilo';

export default function ComoFunciona() {
  return (
    <section id="como" aria-labelledby="titulo-como" className={`${container} py-16 sm:py-20`}>
      <h2 id="titulo-como" className={`${tituloSecao} m-0 max-w-[640px]`}>
        Do cadastro ao primeiro lembrete no mesmo dia
      </h2>
      <ol className="list-none p-0 mt-10 mb-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-5">
        {PASSOS.map((p, i) => (
          <li key={p.titulo} className="border-t-2 border-[#15171A] pt-5">
            <span className={`${titulo} text-[15px] font-bold text-[#136F4D]`} aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className="mt-2 mb-0 text-[20px] font-bold">
              <span className="sr-only">Passo {i + 1}: </span>{p.titulo}
            </h3>
            <p className="mt-2 mb-0 text-[#4A5059] leading-[1.55]">{p.texto}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

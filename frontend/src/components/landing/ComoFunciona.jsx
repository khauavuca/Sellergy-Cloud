import { PASSOS } from './conteudo';
import Revelar from './Revelar';
import { container, titulo, tituloSecao } from './estilo';

export default function ComoFunciona() {
  return (
    <section id="como" aria-labelledby="titulo-como" className="bg-white border-y border-[#E3E5E8]">
      <div className={`${container} py-20 sm:py-28`}>
        <Revelar className="max-w-[640px]">
          <p className="m-0 text-[13px] font-semibold text-[#136F4D] uppercase tracking-[0.08em]">Como começar</p>
          <h2 id="titulo-como" className={`${tituloSecao} mt-3 mb-0`}>
            Do cadastro ao primeiro lembrete no mesmo dia
          </h2>
        </Revelar>
        <div className="relative mt-14">
          {/* linha ligando os passos (desktop), cresce da esquerda pra direita */}
          <Revelar
            como="span"
            atraso={200}
            aria-hidden="true"
            className="hidden md:block absolute top-7 left-[calc(16.66%+28px)] right-[calc(16.66%+28px)] h-0.5 bg-gradient-to-r from-[#136F4D] via-[#1FA672] to-[#136F4D] origin-left ld-crescer"
          />
          <ol className="list-none p-0 m-0 grid gap-10 md:grid-cols-3 md:gap-6">
          {PASSOS.map((p, i) => (
            <Revelar key={p.titulo} como="li" atraso={i * 160} className="relative flex flex-col items-start md:items-center md:text-center">
              <span
                className={`${titulo} relative z-10 w-14 h-14 rounded-full grid place-items-center text-[20px] font-bold text-white bg-[#136F4D] shadow-[0_0_0_8px_#fff,0_12px_30px_rgba(19,111,77,0.35)]`}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <h3 className="mt-5 mb-0 text-[20px] font-bold">
                <span className="sr-only">Passo {i + 1}: </span>{p.titulo}
              </h3>
              <p className="mt-2 mb-0 text-[#4A5059] leading-[1.6] max-w-[340px]">{p.texto}</p>
            </Revelar>
          ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

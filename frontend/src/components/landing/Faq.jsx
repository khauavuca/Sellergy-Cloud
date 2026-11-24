import { useId, useState } from 'react';
import { PERGUNTAS } from './conteudo';
import { foco, tituloSecao } from './estilo';

export default function Faq() {
  const [aberta, setAberta] = useState(0);
  const base = useId();

  return (
    <section id="duvidas" aria-labelledby="titulo-duvidas" className="max-w-[860px] mx-auto px-6 py-16 sm:py-20">
      <h2 id="titulo-duvidas" className={`${tituloSecao} mt-0 mb-5`}>Dúvidas frequentes</h2>
      {PERGUNTAS.map((f, i) => {
        const expandida = aberta === i;
        const idBotao = `${base}-p-${i}`;
        const idResposta = `${base}-r-${i}`;
        return (
          <div key={f.pergunta} className="border-b border-[#DADDD8]">
            <h3 className="m-0 text-[17px] font-semibold">
              <button
                type="button"
                id={idBotao}
                aria-expanded={expandida}
                aria-controls={idResposta}
                onClick={() => setAberta(expandida ? -1 : i)}
                className={`w-full flex justify-between items-center gap-4 min-h-11 py-[22px] bg-transparent border-0 text-left text-[17px] font-semibold text-[#15171A] cursor-pointer rounded-md ${foco}`}
              >
                {f.pergunta}
                <span aria-hidden="true" className="w-[22px] shrink-0 text-center text-[22px] font-normal text-[#5B616B]">
                  {expandida ? '−' : '+'}
                </span>
              </button>
            </h3>
            <div id={idResposta} role="region" aria-labelledby={idBotao} hidden={!expandida}>
              <p className="mt-0 mb-[22px] text-[#4A5059] leading-[1.6] max-w-[700px]">{f.resposta}</p>
            </div>
          </div>
        );
      })}
    </section>
  );
}

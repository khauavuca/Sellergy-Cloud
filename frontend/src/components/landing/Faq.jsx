import { useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { PERGUNTAS } from './conteudo';
import { foco, titulo } from './estilo';

export default function Faq() {
  const [aberta, setAberta] = useState(0);
  const base = useId();

  return (
    <section id="duvidas" aria-labelledby="titulo-duvidas" className="scroll-mt-20 max-w-[860px] mx-auto px-4 sm:px-6 py-16 md:py-20">
      <h2 id="titulo-duvidas" className={`${titulo} text-[32px] md:text-[40px] leading-[1.1] font-bold mt-0 mb-5`}>
        Dúvidas frequentes
      </h2>
      <div>
        {PERGUNTAS.map((f, i) => {
          const expandida = aberta === i;
          const idBotao = `${base}-p-${i}`;
          const idResposta = `${base}-r-${i}`;
          return (
            <div key={f.pergunta} className="border-b border-[#DADDD8]">
              <h3 className="m-0">
                <button
                  type="button"
                  id={idBotao}
                  aria-expanded={expandida}
                  aria-controls={idResposta}
                  onClick={() => setAberta(expandida ? -1 : i)}
                  className={`w-full flex justify-between items-center gap-4 min-h-11 py-5 text-left text-[17px] font-semibold text-[#15171A] cursor-pointer rounded-md ${foco}`}
                >
                  {f.pergunta}
                  {expandida
                    ? <Minus size={20} className="text-[#5B616B] shrink-0" aria-hidden="true" />
                    : <Plus size={20} className="text-[#5B616B] shrink-0" aria-hidden="true" />}
                </button>
              </h3>
              <div id={idResposta} role="region" aria-labelledby={idBotao} hidden={!expandida}>
                <p className="mt-0 mb-5 text-[#4A5059] leading-relaxed max-w-[700px]">{f.resposta}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

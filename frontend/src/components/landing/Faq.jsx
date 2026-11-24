import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { PERGUNTAS } from './conteudo';
import Revelar from './Revelar';
import { foco, tituloSecao } from './estilo';

export default function Faq() {
  const [aberta, setAberta] = useState(0);
  const base = useId();

  return (
    <section id="duvidas" aria-labelledby="titulo-duvidas" className="max-w-[860px] mx-auto px-6 py-20 sm:py-28">
      <Revelar>
        <h2 id="titulo-duvidas" className={`${tituloSecao} mt-0 mb-8`}>Dúvidas frequentes</h2>
      </Revelar>
      <div className="flex flex-col gap-3">
        {PERGUNTAS.map((f, i) => {
          const expandida = aberta === i;
          const idBotao = `${base}-p-${i}`;
          const idResposta = `${base}-r-${i}`;
          return (
            <Revelar
              key={f.pergunta}
              atraso={i * 70}
              className={`rounded-2xl border transition-colors duration-300 ${
                expandida ? 'bg-white border-[#D7E9DF] shadow-[0_14px_36px_rgba(19,111,77,0.08)]' : 'bg-white/60 border-[#E3E5E8] hover:bg-white'
              }`}
            >
              <h3 className="m-0 text-[17px] font-semibold">
                <button
                  type="button"
                  id={idBotao}
                  aria-expanded={expandida}
                  aria-controls={idResposta}
                  onClick={() => setAberta(expandida ? -1 : i)}
                  className={`w-full flex justify-between items-center gap-4 min-h-11 px-6 py-5 bg-transparent border-0 text-left text-[17px] font-semibold text-[#15171A] cursor-pointer rounded-2xl ${foco}`}
                >
                  {f.pergunta}
                  <span
                    aria-hidden="true"
                    className={`w-8 h-8 shrink-0 rounded-full grid place-items-center transition-[rotate,background-color,color] duration-300 ${
                      expandida ? 'rotate-45 bg-[#136F4D] text-white' : 'bg-[#F1F2EF] text-[#3D434B]'
                    }`}
                  >
                    <Plus size={18} />
                  </span>
                </button>
              </h3>
              {/* grid 0fr -> 1fr: abre e fecha com altura animada */}
              <div
                id={idResposta}
                role="region"
                aria-labelledby={idBotao}
                inert={!expandida}
                className={`grid transition-[grid-template-rows] duration-300 ease-out ${expandida ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
              >
                <div className="overflow-hidden">
                  <p className="mt-0 mb-0 px-6 pb-6 text-[#4A5059] leading-[1.6] max-w-[700px]">{f.resposta}</p>
                </div>
              </div>
            </Revelar>
          );
        })}
      </div>
    </section>
  );
}

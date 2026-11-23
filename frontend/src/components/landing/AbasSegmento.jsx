import { useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { SEGMENTOS } from './conteudo';
import { container, foco, sobretitulo, titulo } from './estilo';

export default function AbasSegmento() {
  const [ativo, setAtivo] = useState(0);
  const base = useId();
  const refs = useRef([]);

  // Setas/Home/End movem entre as abas (padrao WAI-ARIA de tabs).
  const aoTeclar = (e) => {
    const total = SEGMENTOS.length;
    let novo = null;
    if (e.key === 'ArrowRight') novo = (ativo + 1) % total;
    else if (e.key === 'ArrowLeft') novo = (ativo - 1 + total) % total;
    else if (e.key === 'Home') novo = 0;
    else if (e.key === 'End') novo = total - 1;
    if (novo === null) return;
    e.preventDefault();
    setAtivo(novo);
    refs.current[novo]?.focus();
  };

  const segmento = SEGMENTOS[ativo];

  return (
    <section id="negocios" aria-labelledby="titulo-negocios" className="scroll-mt-20 bg-white border-y border-[#E3E5E8]">
      <div className={`${container} py-16 md:py-20`}>
        <div className="flex flex-wrap justify-between items-end gap-6">
          <div className="max-w-[620px]">
            <p className={`${sobretitulo} m-0`}>Um sistema, dois jeitos de atender</p>
            <h2 id="titulo-negocios" className={`${titulo} text-[32px] md:text-[40px] leading-[1.1] font-bold mt-3 mb-0`}>
              Feito para quem atende no balcão e na cadeira
            </h2>
          </div>
          <div role="tablist" aria-label="Tipo de negócio" className="flex gap-1 p-1 bg-[#F1F2EF] rounded-full">
            {SEGMENTOS.map((s, i) => {
              const selecionado = i === ativo;
              return (
                <button
                  key={s.id}
                  ref={(el) => { refs.current[i] = el; }}
                  type="button"
                  role="tab"
                  id={`${base}-aba-${s.id}`}
                  aria-selected={selecionado}
                  aria-controls={`${base}-painel`}
                  tabIndex={selecionado ? 0 : -1}
                  onClick={() => setAtivo(i)}
                  onKeyDown={aoTeclar}
                  className={`min-h-11 px-[18px] rounded-full text-[15px] font-semibold transition-colors cursor-pointer ${foco} ${
                    selecionado ? 'bg-[#15171A] text-white' : 'text-[#4A5059] hover:text-[#15171A]'
                  }`}
                >
                  {s.rotulo}
                </button>
              );
            })}
          </div>
        </div>

        <div
          role="tabpanel"
          id={`${base}-painel`}
          aria-labelledby={`${base}-aba-${segmento.id}`}
          tabIndex={0}
          className={`grid gap-5 mt-10 md:grid-cols-3 rounded-2xl ${foco}`}
        >
          {segmento.itens.map((b) => (
            <article key={b.titulo} className="bg-[#F6F7F5] rounded-[18px] p-7 flex flex-col gap-3">
              <p className="m-0 text-[13px] font-semibold text-[#136F4D]">{b.chave}</p>
              <h3 className={`${titulo} m-0 text-2xl font-bold`}>{b.titulo}</h3>
              <p className="m-0 text-[#4A5059] leading-relaxed">{b.texto}</p>
              <ul className="list-none p-0 mt-1.5 mb-0 flex flex-col gap-2">
                {b.pontos.map((p) => (
                  <li key={p} className="flex gap-2 items-center text-sm font-medium">
                    <Check size={16} strokeWidth={2.2} className="text-[#136F4D] shrink-0" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

import { useId, useRef } from 'react';
import { IconeCheck } from './Icones';
import { SEGMENTOS } from './conteudo';
import { aba, container, foco, titulo, tituloSecao } from './estilo';

export default function AbasSegmento({ ativo, aoTrocar }) {
  const base = useId();
  const refs = useRef([]);
  const indice = Math.max(0, SEGMENTOS.findIndex((s) => s.id === ativo));
  const segmento = SEGMENTOS[indice];

  // Setas/Home/End movem entre as abas (padrao WAI-ARIA de tabs).
  const aoTeclar = (e) => {
    const total = SEGMENTOS.length;
    let novo = null;
    if (e.key === 'ArrowRight') novo = (indice + 1) % total;
    else if (e.key === 'ArrowLeft') novo = (indice - 1 + total) % total;
    else if (e.key === 'Home') novo = 0;
    else if (e.key === 'End') novo = total - 1;
    if (novo === null) return;
    e.preventDefault();
    aoTrocar(SEGMENTOS[novo].id);
    refs.current[novo]?.focus();
  };

  return (
    <section id="negocios" aria-labelledby="titulo-negocios" className="bg-white border-y border-[#E3E5E8]">
      <div className={`${container} py-16 sm:py-20`}>
        <div className="flex flex-wrap justify-between items-end gap-6">
          <div className="max-w-[620px]">
            <p className="m-0 text-[13px] font-semibold text-[#136F4D] uppercase tracking-[0.08em]">
              Um sistema, dois jeitos de atender
            </p>
            <h2 id="titulo-negocios" className={`${tituloSecao} mt-3 mb-0`}>
              Feito para quem atende no balcão e na cadeira
            </h2>
          </div>
          <div role="tablist" aria-label="Tipo de negócio" className="flex gap-1 p-1 bg-[#F1F2EF] rounded-full">
            {SEGMENTOS.map((s, i) => {
              const selecionado = i === indice;
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
                  onClick={() => aoTrocar(s.id)}
                  onKeyDown={aoTeclar}
                  className={aba(selecionado)}
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
          className={`grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-5 mt-10 rounded-[18px] ${foco}`}
        >
          {segmento.itens.map((b) => (
            <article key={b.titulo} className="bg-[#F6F7F5] rounded-[18px] p-7 flex flex-col gap-3">
              <p className="m-0 text-[13px] font-semibold text-[#136F4D]">{b.chave}</p>
              <h3 className={`${titulo} m-0 text-[24px] font-bold tracking-[-0.015em]`}>{b.titulo}</h3>
              <p className="m-0 text-[#4A5059] leading-[1.55]">{b.texto}</p>
              <ul className="list-none p-0 mt-1.5 mb-0 flex flex-col gap-2">
                {b.pontos.map((p) => (
                  <li key={p} className="flex gap-2 items-center text-[14px] font-medium min-w-0">
                    <IconeCheck tamanho={16} className="text-[#136F4D]" />
                    <span className="min-w-0 break-words">{p}</span>
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

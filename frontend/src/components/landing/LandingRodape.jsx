import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { LINKS_LEGAIS, ROTA_CADASTRO, linkWhatsapp } from './conteudo';
import { focoEscuro, titulo } from './estilo';

const linkRodape = `inline-flex items-center min-h-11 rounded text-[#B9BEC6] no-underline hover:text-white hover:underline ${focoEscuro}`;

export default function LandingRodape() {
  const whatsapp = linkWhatsapp();

  return (
    <div className="bg-[#15171A] text-white">
      <section aria-labelledby="titulo-cta" className="max-w-[1200px] mx-auto px-6 py-16 sm:py-[72px] flex flex-wrap justify-between items-center gap-8">
        <div>
          <h2 id="titulo-cta" className={`${titulo} text-[30px] sm:text-[36px] leading-[1.1] tracking-[-0.02em] font-bold m-0 max-w-[620px]`}>
            Em 14 dias você sabe se é pra você.
          </h2>
          <p className="mt-3 mb-0 text-[#B9BEC6] text-[17px]">Sem cartão, sem instalação, sem contrato.</p>
        </div>
        <Link
          to={ROTA_CADASTRO}
          className={`inline-flex items-center justify-center min-h-[54px] px-7 rounded-[10px] font-semibold text-[16px] no-underline bg-[#136F4D] text-white border border-[#136F4D] hover:bg-[#0F5C40] hover:text-white transition-colors ${focoEscuro}`}
        >
          Criar minha conta
        </Link>
      </section>

      <footer className="max-w-[1200px] mx-auto px-6 py-3 border-t border-[#2C3036] flex flex-wrap justify-between items-center gap-x-3 text-[13px] text-[#B9BEC6]">
        <span className="py-3">Sellergy Cloud · sellergycloud.com</span>
        <nav aria-label="Informações legais e contato">
          <ul className="list-none p-0 m-0 flex flex-wrap items-center gap-x-1.5">
            {LINKS_LEGAIS.map((l, i) => (
              <Fragment key={l.to}>
                {i > 0 && <li aria-hidden="true">·</li>}
                <li><Link to={l.to} className={linkRodape}>{l.rotulo}</Link></li>
              </Fragment>
            ))}
            {whatsapp && (
              <>
                <li aria-hidden="true">·</li>
                <li>
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={linkRodape}>
                    Contato<span className="sr-only"> pelo WhatsApp (abre em nova aba)</span>
                  </a>
                </li>
              </>
            )}
          </ul>
        </nav>
      </footer>
    </div>
  );
}

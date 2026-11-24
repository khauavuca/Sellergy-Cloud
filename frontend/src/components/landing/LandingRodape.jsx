import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { LINKS_LEGAIS, ROTA_CADASTRO, linkWhatsapp } from './conteudo';
import { focoEscuro, titulo } from './estilo';
import Revelar from './Revelar';
import { IconeSeta } from './Icones';

const linkRodape = `inline-flex items-center min-h-11 rounded text-[#B9BEC6] no-underline hover:text-white hover:underline ${focoEscuro}`;

export default function LandingRodape() {
  const whatsapp = linkWhatsapp();

  return (
    <div className="relative overflow-hidden bg-[#0E1311] text-white">
      <div className="ld-bolha w-[600px] h-[600px] bg-[#136F4D]/45 -top-64 left-1/2 -translate-x-1/2" aria-hidden="true" />
      <div className="ld-bolha w-[360px] h-[360px] bg-[#F2C46B]/10 -bottom-40 -left-20" style={{ animationDelay: '-9s' }} aria-hidden="true" />

      <section aria-labelledby="titulo-cta" className="relative max-w-[900px] mx-auto px-6 py-24 sm:py-32 text-center">
        <Revelar>
          <h2 id="titulo-cta" className={`${titulo} text-[34px] sm:text-[52px] leading-[1.05] tracking-[-0.03em] font-bold m-0`}>
            Amanhã pode ser o primeiro dia <span className="ld-texto-vivo-claro">sem caderno.</span>
          </h2>
          <p className="mt-5 mb-0 text-[#B4BCB8] text-[18px] leading-[1.6] max-w-[560px] mx-auto">
            Em 14 dias você sabe se é pra você. Sem cartão, sem instalação, sem contrato.
          </p>
          <Link
            to={ROTA_CADASTRO}
            className={`ld-brilho group mt-9 inline-flex items-center justify-center gap-2 min-h-[56px] px-8 rounded-xl font-semibold text-[17px] no-underline bg-[#136F4D] text-white border border-[#1FA672] shadow-[0_0_0_6px_rgba(31,166,114,0.15),0_20px_50px_rgba(19,111,77,0.5)] hover:bg-[#0F5C40] hover:text-white transition-colors ${focoEscuro}`}
          >
            Criar minha conta grátis
            <IconeSeta className="transition-transform group-hover:translate-x-1" />
          </Link>
        </Revelar>
      </section>

      <footer className="relative max-w-[1200px] mx-auto px-6 py-3 border-t border-[#262C29] flex flex-wrap justify-between items-center gap-x-3 text-[13px] text-[#B9BEC6]">
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

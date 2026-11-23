import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { LINKS_LEGAIS, ROTA_CADASTRO, ROTA_LOGIN, WHATSAPP_CONTATO, linkWhatsapp } from './conteudo';
import { botaoAmbar, container, titulo } from './estilo';
import Marca from './Marca';

const focoEscuro =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F2C46B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F3D2C]';
const linkRodape = `inline-flex items-center min-h-11 rounded-md text-[#D3DED8] no-underline hover:text-white hover:underline ${focoEscuro}`;

export default function LandingRodape() {
  const whatsapp = linkWhatsapp();

  return (
    <>
      <section aria-labelledby="titulo-cta" className="bg-[#0F3D2C] text-white">
        <div className={`${container} py-16 md:py-[72px] flex flex-wrap justify-between items-center gap-8`}>
          <div>
            <h2 id="titulo-cta" className={`${titulo} text-[30px] md:text-[36px] leading-[1.1] font-bold m-0 max-w-[620px]`}>
              Em 14 dias você sabe se é pra você.
            </h2>
            <p className="mt-3 mb-0 text-[#C9D6CF] text-[17px]">Sem cartão, sem instalação, sem contrato.</p>
          </div>
          <Link to={ROTA_CADASTRO} className={`${botaoAmbar} min-h-[54px] px-7 text-base ${focoEscuro}`}>
            Testar grátis por 14 dias
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <footer className="bg-[#0B2E21] text-[#D3DED8] text-sm">
        <div className={`${container} py-10 grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]`}>
          <div className="flex flex-col gap-3">
            <Marca claro />
            <p className="m-0 max-w-[340px] leading-relaxed">
              Agenda, vendas, Pix, estoque e nota fiscal para clínicas de estética e lojas pequenas.
            </p>
          </div>
          <nav aria-label="Produto">
            <h2 className="m-0 mb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-white">Produto</h2>
            <ul className="list-none p-0 m-0">
              <li><a href="#recursos" className={linkRodape}>Recursos</a></li>
              <li><a href="#precos" className={linkRodape}>Preços</a></li>
              <li><a href="#duvidas" className={linkRodape}>Dúvidas frequentes</a></li>
              <li><Link to={ROTA_LOGIN} className={linkRodape}>Entrar</Link></li>
            </ul>
          </nav>
          <nav aria-label="Contato e informações legais">
            <h2 className="m-0 mb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-white">Fale com a gente</h2>
            <ul className="list-none p-0 m-0">
              <li>
                {whatsapp ? (
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${linkRodape} gap-2`}>
                    <MessageCircle size={16} aria-hidden="true" />
                    WhatsApp
                    <span className="sr-only"> (abre em nova aba)</span>
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-2 min-h-11">
                    <MessageCircle size={16} aria-hidden="true" />
                    WhatsApp: {WHATSAPP_CONTATO}
                  </span>
                )}
              </li>
              {LINKS_LEGAIS.map((l) => (
                <li key={l.rotulo}><a href={l.href} className={linkRodape}>{l.rotulo}</a></li>
              ))}
            </ul>
          </nav>
        </div>
        <div className={`${container} py-5 border-t border-[#1F4A39] text-[13px]`}>
          © {new Date().getFullYear()} Sellergy Cloud. Todos os direitos reservados.
        </div>
      </footer>
    </>
  );
}

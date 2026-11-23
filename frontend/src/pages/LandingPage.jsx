import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import LandingHeader from '../components/landing/LandingHeader';
import MockProduto from '../components/landing/MockProduto';
import AbasSegmento from '../components/landing/AbasSegmento';
import Recursos from '../components/landing/Recursos';
import ComoFunciona from '../components/landing/ComoFunciona';
import Precos from '../components/landing/Precos';
import Faq from '../components/landing/Faq';
import LandingRodape from '../components/landing/LandingRodape';
import { ROTA_CADASTRO, ROTA_LOGIN } from '../components/landing/conteudo';
import { botaoPrimario, botaoSecundario, container, foco, titulo } from '../components/landing/estilo';

const GARANTIAS = ['14 dias com tudo do Profissional', 'Sem cartão de crédito', 'Cancele quando quiser'];

export default function LandingPage() {
  return (
    // Cores fixas: a landing nao segue o tema escuro do painel.
    <div className="min-h-screen bg-[#F6F7F5] text-[#15171A] font-[family-name:Inter,system-ui,sans-serif] antialiased">
      <a
        href="#conteudo"
        className={`sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-3 focus:rounded-lg focus:bg-white focus:text-[#15171A] focus:shadow-lg ${foco}`}
      >
        Pular para o conteúdo
      </a>

      <LandingHeader />

      <main id="conteudo" tabIndex={-1} className="outline-none">
        {/* Hero */}
        <section aria-labelledby="titulo-hero" className={`${container} pt-12 pb-16 md:pt-[72px] md:pb-20 grid gap-12 lg:gap-14 lg:grid-cols-2 items-center`}>
          <div>
            <p className="inline-flex m-0 px-3 py-1.5 rounded-full bg-[#E3F1EA] text-[#0E5C34] font-semibold text-[13px]">
              Para clínicas de estética e lojas pequenas
            </p>
            <h1
              id="titulo-hero"
              className={`${titulo} text-[40px] sm:text-[48px] lg:text-[60px] leading-[1.03] tracking-[-0.035em] font-bold mt-5 mb-0`}
            >
              Saia do caderno. Venda, agende e receba pelo WhatsApp.
            </h1>
            <p className="text-lg md:text-[19px] leading-relaxed text-[#4A5059] mt-5 mb-0 max-w-[540px]">
              Agenda com lembrete automático, venda no balcão com Pix, caixa que abre sozinho, estoque e nota fiscal.
              Tudo num lugar só, por um preço fixo e sem fidelidade.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link to={ROTA_CADASTRO} className={`${botaoPrimario} min-h-[52px] px-6 text-base`}>
                Testar grátis por 14 dias
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link to={ROTA_LOGIN} className={`${botaoSecundario} min-h-[52px] px-6 text-base`}>
                Entrar
              </Link>
            </div>
            <ul className="list-none p-0 mt-6 mb-0 flex flex-wrap gap-x-6 gap-y-2 text-[#4A5059] text-sm">
              {GARANTIAS.map((g) => (
                <li key={g} className="flex gap-1.5 items-center">
                  <Check size={18} strokeWidth={2.2} className="text-[#136F4D]" aria-hidden="true" />
                  {g}
                </li>
              ))}
            </ul>
          </div>

          <MockProduto />
        </section>

        <AbasSegmento />
        <Recursos />
        <ComoFunciona />
        <Precos />
        <Faq />
      </main>

      <LandingRodape />
    </div>
  );
}

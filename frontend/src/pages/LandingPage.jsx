import { useState } from 'react';
import { Link } from 'react-router-dom';
import LandingHeader from '../components/landing/LandingHeader';
import MockProduto from '../components/landing/MockProduto';
import AbasSegmento from '../components/landing/AbasSegmento';
import ComoFunciona from '../components/landing/ComoFunciona';
import Precos from '../components/landing/Precos';
import Faq from '../components/landing/Faq';
import LandingRodape from '../components/landing/LandingRodape';
import { IconeCheck, IconeSeta } from '../components/landing/Icones';
import { ROTA_CADASTRO } from '../components/landing/conteudo';
import { botaoPrimario, botaoSecundario, foco, titulo } from '../components/landing/estilo';

const GARANTIAS = ['14 dias com tudo liberado', 'Sem cartão de crédito', 'Cancele quando quiser'];

export default function LandingPage() {
  // Aba aberta em "Feito para quem atende..."; o menu "Para lojas/clinicas" troca.
  const [segmento, setSegmento] = useState('clinicas');

  return (
    // Cores fixas (igual ao prototipo): a landing nao segue o tema escuro do painel.
    <div className="min-h-screen bg-[#F6F7F5] text-[#15171A] font-[family-name:Inter,system-ui,sans-serif] leading-[normal] antialiased">
      <a
        href="#conteudo"
        className={`sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-3 focus:rounded-lg focus:bg-white focus:text-[#15171A] focus:shadow-lg ${foco}`}
      >
        Pular para o conteúdo
      </a>

      <LandingHeader aoEscolherSegmento={setSegmento} />

      <main id="conteudo" tabIndex={-1} className="outline-none">
        {/* Hero */}
        <section
          aria-labelledby="titulo-hero"
          className="max-w-[1200px] mx-auto px-6 pt-12 pb-16 sm:pt-[72px] grid grid-cols-[repeat(auto-fit,minmax(min(100%,480px),1fr))] gap-14 items-center"
        >
          <div className="min-w-0">
            <p className="inline-flex m-0 px-3 py-1.5 rounded-full bg-[#E3F1EA] text-[#0E5C34] font-semibold text-[13px]">
              Para lojas, clínicas e estética
            </p>
            <h1
              id="titulo-hero"
              className={`${titulo} text-[clamp(40px,5vw,62px)] leading-[1.02] tracking-[-0.035em] font-bold mt-5 mb-0`}
            >
              Saia do caderno. Venda, agende e receba pelo WhatsApp.
            </h1>
            <p className="text-[19px] leading-[1.55] text-[#4A5059] mt-[22px] mb-0 max-w-[540px]">
              Agenda com lembrete automático, venda no balcão com Pix, caixa que abre sozinho e nota fiscal. Tudo num
              lugar só, por um preço fixo e sem fidelidade.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link to={ROTA_CADASTRO} className={`${botaoPrimario} min-h-[52px] px-[26px] text-[16px]`}>
                Começar teste grátis
                <IconeSeta />
              </Link>
              <a href="#como" className={`${botaoSecundario} min-h-[52px] px-6 text-[16px]`}>
                Ver como funciona
              </a>
            </div>
            <ul className="list-none p-0 mt-[26px] mb-0 flex flex-wrap gap-x-[22px] gap-y-2 text-[#4A5059] text-[14px]">
              {GARANTIAS.map((g) => (
                <li key={g} className="flex gap-1.5 items-center">
                  <IconeCheck className="text-[#136F4D]" />
                  {g}
                </li>
              ))}
            </ul>
          </div>

          <MockProduto />
        </section>

        <AbasSegmento ativo={segmento} aoTrocar={setSegmento} />
        <ComoFunciona />
        <Precos />
        <Faq />
      </main>

      <LandingRodape />
    </div>
  );
}

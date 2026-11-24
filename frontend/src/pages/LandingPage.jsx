import { useState } from 'react';
import { Link } from 'react-router-dom';
import LandingHeader from '../components/landing/LandingHeader';
import MockProduto from '../components/landing/MockProduto';
import FaixaRecursos from '../components/landing/FaixaRecursos';
import AntesDepois from '../components/landing/AntesDepois';
import UmDia from '../components/landing/UmDia';
import AbasSegmento from '../components/landing/AbasSegmento';
import Vantagens from '../components/landing/Vantagens';
import ComoFunciona from '../components/landing/ComoFunciona';
import Precos from '../components/landing/Precos';
import Faq from '../components/landing/Faq';
import LandingRodape from '../components/landing/LandingRodape';
import { IconeCheck, IconeSeta } from '../components/landing/Icones';
import { ROTA_CADASTRO } from '../components/landing/conteudo';
import { botaoPrimario, botaoSecundario, foco, titulo } from '../components/landing/estilo';
import '../components/landing/animacoes.css';

const GARANTIAS = ['14 dias com tudo liberado', 'Sem cartão de crédito', 'Cancele quando quiser'];
const atraso = (ms) => ({ '--ld-atraso': `${ms}ms` });

// A pagina conta uma historia: a rotina de hoje (AntesDepois), um dia com o
// sistema (UmDia), pra quem e (AbasSegmento), por que vale (Vantagens) e
// como comecar (ComoFunciona, Precos, CTA final).
export default function LandingPage() {
  // Aba aberta em "Feito para quem atende..."; o menu "Para lojas/clinicas" troca.
  const [segmento, setSegmento] = useState('clinicas');

  return (
    // Cores fixas (igual ao prototipo): a landing nao segue o tema escuro do painel.
    <div className="ld-raiz min-h-screen bg-[#F6F7F5] text-[#15171A] font-[family-name:Inter,system-ui,sans-serif] leading-[normal] antialiased overflow-x-clip">
      <a
        href="#conteudo"
        className={`sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-3 focus:rounded-lg focus:bg-white focus:text-[#15171A] focus:shadow-lg ${foco}`}
      >
        Pular para o conteúdo
      </a>

      <LandingHeader aoEscolherSegmento={setSegmento} />

      <main id="conteudo" tabIndex={-1} className="outline-none">
        {/* Hero */}
        <section aria-labelledby="titulo-hero" className="relative isolate">
          <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
            <div className="ld-grade" />
            <div className="ld-bolha w-[560px] h-[560px] bg-[#1FA672]/25 -top-48 -right-24" />
            <div className="ld-bolha w-[440px] h-[440px] bg-[#F2C46B]/25 top-40 -left-40" style={{ animationDelay: '-6s' }} />
          </div>

          <div className="max-w-[1200px] mx-auto px-6 pt-12 pb-20 sm:pt-[76px] sm:pb-24 grid grid-cols-[repeat(auto-fit,minmax(min(100%,480px),1fr))] gap-14 items-center">
            <div className="min-w-0">
              <p className="ld-entrar inline-flex items-center gap-2 m-0 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white/80 backdrop-blur border border-[#D7E9DF] text-[#0E5C34] font-semibold text-[13px] shadow-[0_4px_14px_rgba(19,111,77,0.08)]">
                <span className="relative flex w-2 h-2" aria-hidden="true">
                  <span className="ld-ping absolute inline-flex h-full w-full rounded-full bg-[#1FA672] opacity-70" />
                  <span className="relative inline-flex w-2 h-2 rounded-full bg-[#136F4D]" />
                </span>
                Para lojas, clínicas e estética
              </p>
              <h1
                id="titulo-hero"
                className={`${titulo} ld-entrar text-[clamp(40px,5.2vw,66px)] leading-[1.02] tracking-[-0.035em] font-bold mt-5 mb-0`}
                style={atraso(100)}
              >
                Saia do caderno. Venda, agende e receba pelo <span className="ld-texto-vivo">WhatsApp.</span>
              </h1>
              <p className="ld-entrar text-[19px] leading-[1.55] text-[#4A5059] mt-[22px] mb-0 max-w-[540px]" style={atraso(220)}>
                Agenda com lembrete automático, venda no balcão com Pix, caixa que abre sozinho e nota fiscal. Tudo num
                lugar só, por um preço fixo e sem fidelidade.
              </p>
              <div className="ld-entrar flex flex-wrap gap-3 mt-8" style={atraso(340)}>
                <Link
                  to={ROTA_CADASTRO}
                  className={`${botaoPrimario} ld-brilho group min-h-[54px] px-[26px] text-[16px] shadow-[0_12px_30px_rgba(19,111,77,0.3)] hover:shadow-[0_16px_36px_rgba(19,111,77,0.38)]`}
                >
                  Começar teste grátis
                  <IconeSeta className="transition-transform group-hover:translate-x-1" />
                </Link>
                <a href="#um-dia" className={`${botaoSecundario} min-h-[54px] px-6 text-[16px]`}>
                  Ver um dia com o Sellergy
                </a>
              </div>
              <ul className="ld-entrar list-none p-0 mt-[26px] mb-0 flex flex-wrap gap-x-[22px] gap-y-2 text-[#4A5059] text-[14px]" style={atraso(460)}>
                {GARANTIAS.map((g) => (
                  <li key={g} className="flex gap-1.5 items-center">
                    <IconeCheck className="text-[#136F4D]" />
                    {g}
                  </li>
                ))}
              </ul>
            </div>

            <MockProduto />
          </div>
        </section>

        <FaixaRecursos />
        <AntesDepois />
        <UmDia />
        <AbasSegmento ativo={segmento} aoTrocar={setSegmento} />
        <Vantagens />
        <ComoFunciona />
        <Precos />
        <Faq />
      </main>

      <LandingRodape />
    </div>
  );
}

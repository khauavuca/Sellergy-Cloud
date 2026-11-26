import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Marca from '../landing/Marca';
import { DATA_TERMOS } from '../../legal/empresa';

const fonteTitulo = "font-[family-name:'Space_Grotesk',Inter,system-ui,sans-serif] tracking-[-0.025em]";
const foco = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#136F4D] focus-visible:ring-offset-2';

/**
 * Layout das paginas legais (Termos, Privacidade).
 * @param {{ titulo: string, resumo: string, secoes: Array<{ id: string, titulo: string, conteudo: React.ReactNode }> }} p
 */
export default function PaginaLegal({ titulo, resumo, secoes }) {
  useEffect(() => {
    document.title = `${titulo} · Sellergy Cloud`;
    return () => { document.title = 'Sellergy Cloud — Agenda, vendas e Pix pelo WhatsApp para clínicas e lojas'; };
  }, [titulo]);

  return (
    <div className="min-h-screen bg-[#F6F7F5] text-[#15171A] font-[family-name:Inter,system-ui,sans-serif] antialiased">
      <header className="border-b border-[#E3E5E8] bg-[#F6F7F5]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-[68px] flex items-center justify-between gap-4">
          <Marca />
          <Link to="/" className={`text-[15px] font-semibold text-[#136F4D] no-underline min-h-11 inline-flex items-center rounded-lg px-2 ${foco}`}>
            Voltar ao site
          </Link>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 md:py-14 grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Nesta página" className="hidden lg:block">
          <div className="sticky top-6">
            <p className="m-0 mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#136F4D]">Nesta página</p>
            <ol className="m-0 p-0 list-none space-y-1">
              {secoes.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className={`block py-1.5 text-[14px] text-[#4A5059] hover:text-[#15171A] no-underline rounded ${foco}`}>
                    {i + 1}. {s.titulo}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <article className="max-w-[760px]">
          <h1 className={`${fonteTitulo} m-0 text-[36px] md:text-[44px] font-bold leading-[1.1]`}>{titulo}</h1>
          <p className="mt-3 mb-0 text-[14px] text-[#5B616B]">Atualizado em {DATA_TERMOS}</p>
          <p className="mt-6 mb-0 text-[17px] leading-[1.65] text-[#3D434B]">{resumo}</p>

          {secoes.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-titulo`} className="mt-10 scroll-mt-6">
              <h2 id={`${s.id}-titulo`} className={`${fonteTitulo} m-0 text-[22px] font-bold`}>
                {i + 1}. {s.titulo}
              </h2>
              <div className="mt-3 text-[16px] leading-[1.7] text-[#3D434B] space-y-3 [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_a]:text-[#136F4D] [&_a]:font-semibold [&_strong]:text-[#15171A]">
                {s.conteudo}
              </div>
            </section>
          ))}

          <p className="mt-12 pt-6 border-t border-[#E3E5E8] text-[14px] text-[#5B616B]">
            Veja também: <Link to="/termos" className="text-[#136F4D] font-semibold">Termos de uso</Link> ·{' '}
            <Link to="/privacidade" className="text-[#136F4D] font-semibold">Política de privacidade</Link>
          </p>
        </article>
      </main>
    </div>
  );
}

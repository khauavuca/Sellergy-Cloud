import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { ROTA_CADASTRO, ROTA_LOGIN } from './conteudo';
import { botaoPrimario, container, foco } from './estilo';
import Marca from './Marca';

const NAV = [
  { href: '#negocios', rotulo: 'Para clínicas e lojas' },
  { href: '#recursos', rotulo: 'Recursos' },
  { href: '#como-funciona', rotulo: 'Como funciona' },
  { href: '#precos', rotulo: 'Preços' },
  { href: '#duvidas', rotulo: 'Dúvidas' },
];

const linkNav = `inline-flex items-center min-h-11 px-3 rounded-lg text-[15px] font-medium text-[#3D434B] no-underline hover:bg-[#ECEEEA] hover:text-[#15171A] ${foco}`;

export default function LandingHeader() {
  const [aberto, setAberto] = useState(false);
  const idMenu = useId();

  useEffect(() => {
    if (!aberto) return undefined;
    const aoTeclar = (e) => { if (e.key === 'Escape') setAberto(false); };
    const aoRedimensionar = () => { if (window.innerWidth >= 1024) setAberto(false); };
    window.addEventListener('keydown', aoTeclar);
    window.addEventListener('resize', aoRedimensionar);
    return () => {
      window.removeEventListener('keydown', aoTeclar);
      window.removeEventListener('resize', aoRedimensionar);
    };
  }, [aberto]);

  const fechar = () => setAberto(false);

  return (
    <header className="sticky top-0 z-40 border-b border-[#E3E5E8] bg-[#F6F7F5]/95 backdrop-blur supports-[backdrop-filter]:bg-[#F6F7F5]/85">
      <div className={`${container} flex items-center gap-4 py-3`}>
        <Marca />

        <nav aria-label="Principal" className="hidden lg:flex items-center gap-0.5 flex-1 ml-4">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className={linkNav}>{item.rotulo}</a>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-2 ml-auto">
          <Link to={ROTA_LOGIN} className={linkNav}>Entrar</Link>
          <Link to={ROTA_CADASTRO} className={botaoPrimario}>Testar grátis</Link>
        </div>

        <button
          type="button"
          className={`lg:hidden ml-auto inline-flex items-center justify-center w-11 h-11 rounded-lg text-[#15171A] hover:bg-[#ECEEEA] ${foco}`}
          aria-expanded={aberto}
          aria-controls={idMenu}
          aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>

      <div id={idMenu} hidden={!aberto} className="lg:hidden border-t border-[#E3E5E8] bg-[#F6F7F5]">
        <nav aria-label="Principal (celular)" className={`${container} flex flex-col py-3`}>
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className={linkNav} onClick={fechar}>{item.rotulo}</a>
          ))}
          <div className="flex flex-col sm:flex-row gap-2 pt-3 mt-2 border-t border-[#E3E5E8]">
            <Link to={ROTA_CADASTRO} className={`${botaoPrimario} w-full sm:w-auto`} onClick={fechar}>
              Testar grátis por 14 dias
            </Link>
            <Link to={ROTA_LOGIN} className={`${linkNav} justify-center`} onClick={fechar}>Entrar</Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

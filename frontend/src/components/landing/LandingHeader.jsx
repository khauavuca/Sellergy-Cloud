import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { ROTA_CADASTRO, ROTA_LOGIN } from './conteudo';
import { botaoPrimario, foco, linkNav } from './estilo';
import Marca from './Marca';
import { URL_AJUDA } from '../../utils/ajuda';

// "Para lojas" / "Para clinicas" levam a #negocios ja com a aba certa aberta.
const NAV = [
  { href: '#negocios', rotulo: 'Para lojas', segmento: 'lojas' },
  { href: '#negocios', rotulo: 'Para clínicas', segmento: 'clinicas' },
  { href: '#precos', rotulo: 'Preços' },
  { href: '#duvidas', rotulo: 'Dúvidas' },
  { href: URL_AJUDA, rotulo: 'Central de ajuda', externo: true },
];

export default function LandingHeader({ aoEscolherSegmento }) {
  const [aberto, setAberto] = useState(false);
  const [rolou, setRolou] = useState(false);
  const idMenu = useId();

  // Vidro com sombra depois que a pagina rola um pouco.
  useEffect(() => {
    const aoRolar = () => setRolou(window.scrollY > 8);
    aoRolar();
    window.addEventListener('scroll', aoRolar, { passive: true });
    return () => window.removeEventListener('scroll', aoRolar);
  }, []);

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

  const aoClicar = (item) => {
    if (item.segmento) aoEscolherSegmento?.(item.segmento);
    setAberto(false);
  };

  const links = NAV.map((item) => (
    <a key={item.rotulo} href={item.href} className={linkNav} onClick={() => aoClicar(item)}
      {...(item.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {item.rotulo}
    </a>
  ));

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-300 ${
        rolou || aberto
          ? 'bg-[#F6F7F5]/80 backdrop-blur-xl border-[#E3E5E8] shadow-[0_8px_30px_rgba(21,23,26,0.06)]'
          : 'bg-transparent border-transparent'
      }`}
    >
      <div className="max-w-[1200px] mx-auto px-6 py-3.5 flex items-center gap-5">
        <Marca />

        <nav aria-label="Principal" className="hidden lg:flex flex-wrap gap-0.5 flex-1">
          {links}
        </nav>
        <div className="hidden lg:block">
          <Link to={ROTA_LOGIN} className={linkNav}>Entrar</Link>
        </div>
        <div className="hidden sm:block ml-auto lg:ml-0">
          <Link to={ROTA_CADASTRO} className={`${botaoPrimario} ld-brilho`}>Testar grátis</Link>
        </div>

        <button
          type="button"
          className={`lg:hidden ml-auto sm:ml-0 inline-flex items-center justify-center w-11 h-11 rounded-lg text-[#15171A] hover:bg-[#ECEEEA] cursor-pointer ${foco}`}
          aria-expanded={aberto}
          aria-controls={idMenu}
          aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>

      <div id={idMenu} hidden={!aberto} className="lg:hidden border-t border-[#E3E5E8]">
        <nav aria-label="Principal (celular)" className="max-w-[1200px] mx-auto px-6 py-3 flex flex-col">
          {links}
          <div className="flex flex-col gap-2 pt-3 mt-2 border-t border-[#E3E5E8]">
            <Link to={ROTA_LOGIN} className={linkNav} onClick={() => setAberto(false)}>Entrar</Link>
            <Link to={ROTA_CADASTRO} className={`${botaoPrimario} w-full`} onClick={() => setAberto(false)}>
              Testar grátis
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

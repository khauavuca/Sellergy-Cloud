import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import SellergyLogo from './SellergyLogo';

/**
 * Menu lateral escuro, aberto e fechado por CLIQUE (nunca por hover).
 *  - Computador: fica fixo na esquerda com 240px (aberto) ou 68px (so icones)
 *    e o layout empurra o conteudo pelo mesmo tanto, entao nada fica coberto.
 *  - Celular: gaveta por cima da tela (prop `mobileOpen`), com fundo escuro.
 */
export default function Sidebar({
  sections = [],
  aberto = true,
  mobileOpen = false,
  onClose,
  onToggle,
  footer,
  branding,
  subtitulo = 'Plataforma',
}) {
  // No celular a gaveta sempre mostra os nomes.
  const comNomes = aberto || mobileOpen;

  return (
    <aside
      aria-label="Menu principal"
      className={clsx(
        'fixed inset-y-0 left-0 z-40 flex flex-col',
        'bg-[var(--sb-bg)] text-white border-r border-[var(--sb-borda)]',
        'transition-[width,transform] duration-200 ease-out',
        'w-[264px]',
        aberto ? 'lg:w-[240px]' : 'lg:w-[68px]',
        mobileOpen ? 'translate-x-0 shadow-[var(--shadow-lg)]' : '-translate-x-full lg:translate-x-0'
      )}
    >
      {/* Marca do negocio */}
      <div className="h-16 flex items-center gap-2.5 px-3.5 border-b border-[var(--sb-borda)] flex-shrink-0">
        {branding?.logo ? (
          <span className="w-9 h-9 rounded-lg bg-[var(--sb-ativo)] flex items-center justify-center flex-shrink-0 overflow-hidden">
            <img src={branding.logo} alt={branding.nome || 'Logo'} className="w-full h-full object-cover" />
          </span>
        ) : (
          <SellergyLogo size={36} className="flex-shrink-0" />
        )}
        {comNomes && (
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight truncate">{branding?.nome || 'Sellergy Cloud'}</div>
            <div className="text-[11px] text-[var(--sb-titulo)] leading-tight truncate">{subtitulo}</div>
          </div>
        )}
        {mobileOpen && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar menu"
            className="lg:hidden w-9 h-9 rounded-lg grid place-items-center text-[var(--sb-texto)] hover:bg-[var(--sb-hover)] hover:text-white"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Itens */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-2.5 py-2">
        {sections.map((section, idx) => (
          <div key={section.titulo || idx}>
            {comNomes ? (
              section.titulo && (
                <div className="px-3 pt-3.5 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--sb-titulo)] whitespace-nowrap">
                  {section.titulo}
                </div>
              )
            ) : (
              idx > 0 && <div className="h-px bg-[var(--sb-borda)] mx-1.5 my-3" aria-hidden="true" />
            )}
            <ul className="flex flex-col gap-0.5 list-none m-0 p-0">
              {section.items.map((item) => (
                <SidebarItem key={item.to} {...item} comNomes={comNomes} onNavegar={onClose} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {footer && <div className="border-t border-[var(--sb-borda)] p-2 flex-shrink-0">{footer}</div>}

      {/* Recolher / abrir (so no computador; no celular fecha pelo X ou fora) */}
      {onToggle && (
        <div className="hidden lg:block border-t border-[var(--sb-borda)] p-2.5 flex-shrink-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={aberto}
            aria-label={aberto ? 'Recolher menu' : 'Abrir menu'}
            title={aberto ? 'Recolher menu' : 'Abrir menu'}
            className="w-full h-10 rounded-lg border border-[var(--sb-borda)] flex items-center justify-center gap-2 text-[13px] font-medium text-[var(--sb-texto)] hover:bg-[var(--sb-hover)] hover:text-white transition-colors"
          >
            {aberto ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            {aberto && <span>Recolher menu</span>}
          </button>
        </div>
      )}
    </aside>
  );
}

const classeItem = (ativo) =>
  clsx(
    'relative flex items-center gap-3 h-9 px-3 rounded-lg text-sm whitespace-nowrap overflow-hidden transition-colors duration-150',
    ativo
      ? 'bg-[var(--sb-ativo)] text-white font-semibold'
      : 'text-[var(--sb-texto)] font-medium hover:bg-[var(--sb-hover)] hover:text-white'
  );

function Selo({ valor, ativo }) {
  if (valor == null || valor === 0) return null;
  return (
    <span
      className={clsx(
        'min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold grid place-items-center flex-shrink-0',
        ativo ? 'bg-white/20 text-white' : 'bg-[#F2C46B] text-[#2A1F05]'
      )}
    >
      {valor}
    </span>
  );
}

function SidebarItem({ to, label, icon: Icon, badge, end = false, subItems, comNomes, onNavegar }) {
  const location = useLocation();
  const temSub = Array.isArray(subItems) && subItems.length > 0;
  const algumSubAtivo = temSub && subItems.some((s) => location.pathname.startsWith(s.to));
  const [expandido, setExpandido] = useState(false);
  const mostraSub = temSub && comNomes && (algumSubAtivo || expandido);

  return (
    <li>
      <div className="flex items-center gap-1">
        <NavLink
          to={to}
          end={end}
          onClick={onNavegar}
          title={comNomes ? undefined : label}
          aria-label={comNomes ? undefined : label}
          className={({ isActive }) => clsx(classeItem(isActive || algumSubAtivo), 'flex-1 min-w-0')}
        >
          {({ isActive }) => (
            <>
              {Icon && <Icon size={18} strokeWidth={1.8} className="flex-shrink-0" aria-hidden="true" />}
              {comNomes && <span className="flex-1 truncate">{label}</span>}
              {comNomes && <Selo valor={badge} ativo={isActive || algumSubAtivo} />}
              {!comNomes && badge ? (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#F2C46B]" aria-hidden="true" />
              ) : null}
            </>
          )}
        </NavLink>
        {temSub && comNomes && !algumSubAtivo && (
          <button
            type="button"
            onClick={() => setExpandido((v) => !v)}
            aria-expanded={expandido}
            aria-label={`${expandido ? 'Esconder' : 'Mostrar'} itens de ${label}`}
            className="w-8 h-9 rounded-lg grid place-items-center text-[var(--sb-titulo)] hover:bg-[var(--sb-hover)] hover:text-white flex-shrink-0"
          >
            <ChevronDown size={14} className={clsx('transition-transform', expandido && 'rotate-180')} />
          </button>
        )}
      </div>
      {mostraSub && (
        <ul className="list-none m-0 p-0 mt-0.5 mb-1 flex flex-col gap-0.5">
          {subItems.map((s) => (
            <li key={s.to}>
              <NavLink
                to={s.to}
                end={s.end}
                onClick={onNavegar}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center h-8 pl-10 pr-3 rounded-lg text-[13px] whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-[var(--sb-sub-ativo)] text-white font-semibold'
                      : 'text-[var(--sb-texto)] font-medium hover:bg-[var(--sb-hover)] hover:text-white'
                  )
                }
              >
                <span className="truncate">{s.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

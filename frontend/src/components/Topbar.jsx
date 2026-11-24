import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, CornerDownLeft } from 'lucide-react';
import clsx from 'clsx';
import UserMenu from './UserMenu';
import NotificacoesDropdown from './NotificacoesDropdown';

const tirarAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Busca do topo: acha qualquer tela do menu pelo nome (Ctrl K foca).
 * `atalhos` = [{ to, label, grupo }].
 */
function BuscaTelas({ atalhos }) {
  const navigate = useNavigate();
  const campo = useRef(null);
  const [termo, setTermo] = useState('');
  const [aberta, setAberta] = useState(false);
  const [indice, setIndice] = useState(0);

  useEffect(() => {
    const aoTeclar = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        campo.current?.focus();
        setAberta(true);
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  const achados = useMemo(() => {
    const t = tirarAcento(termo.trim());
    if (!t) return [];
    return atalhos.filter((a) => tirarAcento(`${a.label} ${a.grupo || ''}`).includes(t)).slice(0, 8);
  }, [termo, atalhos]);

  const ir = (a) => {
    if (!a) return;
    navigate(a.to);
    setTermo('');
    setAberta(false);
    campo.current?.blur();
  };

  const aoTeclarCampo = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndice((i) => Math.min(i + 1, achados.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndice((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); ir(achados[indice]); }
    else if (e.key === 'Escape') { setAberta(false); campo.current?.blur(); }
  };

  return (
    <div className="relative hidden md:block flex-1 min-w-0 max-w-[460px]">
      <label className="h-10 flex items-center gap-2 px-3 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] text-[var(--text-muted)] focus-within:border-[var(--primary)] focus-within:bg-[var(--bg-card)] transition-colors">
        <Search size={16} aria-hidden="true" className="flex-shrink-0" />
        <span className="sr-only">Buscar uma tela do sistema</span>
        <input
          ref={campo}
          type="search"
          value={termo}
          onChange={(e) => { setTermo(e.target.value); setIndice(0); setAberta(true); }}
          onFocus={() => setAberta(true)}
          onBlur={() => setTimeout(() => setAberta(false), 120)}
          onKeyDown={aoTeclarCampo}
          placeholder="Ir para… agenda, vendas, caixa"
          role="combobox"
          aria-expanded={aberta && achados.length > 0}
          aria-controls="busca-telas"
          aria-autocomplete="list"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)]"
        />
        <kbd className="hidden lg:inline-flex text-[11px] font-semibold text-[var(--text-muted)] border border-[var(--border-strong)] rounded px-1.5 py-0.5 flex-shrink-0">
          Ctrl K
        </kbd>
      </label>
      {aberta && achados.length > 0 && (
        <ul
          id="busca-telas"
          role="listbox"
          className="absolute left-0 right-0 top-12 z-50 list-none m-0 p-1.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
        >
          {achados.map((a, i) => (
            <li key={a.to} role="option" aria-selected={i === indice}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => ir(a)}
                onMouseEnter={() => setIndice(i)}
                className={clsx(
                  'w-full h-10 px-3 rounded-lg flex items-center gap-3 text-left text-sm',
                  i === indice ? 'bg-[var(--bg-subtle)] text-[var(--text-main)]' : 'text-[var(--text-secondary)]'
                )}
              >
                <span className="flex-1 truncate font-medium">{a.label}</span>
                {a.grupo && <span className="text-xs text-[var(--text-muted)]">{a.grupo}</span>}
                {i === indice && <CornerDownLeft size={14} className="text-[var(--text-muted)]" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Topo das telas internas. O botao de menu abre a gaveta no celular e
 * abre/recolhe o menu lateral no computador.
 */
export default function Topbar({ titulo, breadcrumb, actions, onMenuClick, onToggleMenu, atalhos = [] }) {
  const aoClicarMenu = () => {
    if (window.matchMedia?.('(min-width: 1024px)').matches) onToggleMenu?.();
    else onMenuClick?.();
  };

  return (
    <header className="sticky top-0 z-30 min-h-16 bg-[var(--bg-card)] border-b border-[var(--border-main)]">
      <div className="min-h-16 px-4 sm:px-6 py-2.5 flex items-center gap-3">
        {(onMenuClick || onToggleMenu) && (
          <button
            type="button"
            onClick={aoClicarMenu}
            aria-label="Abrir ou recolher o menu"
            className="w-10 h-10 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] text-[var(--text-secondary)] grid place-items-center hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)] flex-shrink-0 transition-colors"
          >
            <Menu size={18} />
          </button>
        )}
        <div className="min-w-0 mr-2 flex-shrink">
          {breadcrumb && (
            <div className="text-xs text-[var(--text-muted)] font-medium truncate">{breadcrumb}</div>
          )}
          {titulo && (
            <h1 className="m-0 text-[17px] font-bold text-[var(--text-main)] tracking-tight truncate leading-tight">
              {titulo}
            </h1>
          )}
        </div>

        {atalhos.length > 0 && <BuscaTelas atalhos={atalhos} />}

        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {actions}
          <NotificacoesDropdown />
          <div className="w-px h-6 bg-[var(--border-main)] mx-0.5 hidden sm:block" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

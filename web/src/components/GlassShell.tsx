import { LogOut, Moon, MonitorPlay, Search, Sparkles, Sun, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { BrandMark } from './BrandMark';
import { LiquidGlassFilter } from './LiquidGlassFilter';
import { formatInAppTimeZone } from '../utils/dateTime';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource/ibm-plex-mono/500.css';
import '../pages/dashboard-glass.css';
import '../pages/glass-app.css';

export interface GlassNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const SearchContext = createContext<{ query: string; setQuery: (value: string) => void }>({
  query: '',
  setQuery: () => undefined,
});

/** Topbar search text, read by the dashboard table. */
export function useDashboardSearch() {
  return useContext(SearchContext);
}

interface GlassShellProps {
  navItems: GlassNavItem[];
  /** Title block for every screen except the overview, which has its own hero. */
  heading?: { eyebrow: string; title: string; description: string } | null;
  terminal?: boolean;
  dark: boolean;
  displayName: string;
  email?: string | null;
  initials: string;
  online: boolean;
  presentationActive: boolean;
  motionReduced: boolean;
  mainRef: RefObject<HTMLElement>;
  onToggleTheme: (origin?: { x: number; y: number }) => void;
  onTogglePresentation: () => void;
  onToggleMotion: () => void;
  onLogout: () => Promise<void>;
  children: React.ReactNode;
}

function greeting() {
  const hour = Number(formatInAppTimeZone(new Date(), { hour: '2-digit', hourCycle: 'h23' }));
  if (hour < 5) return 'Boa noite';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function isActivePath(pathname: string, target: string) {
  if (target === '/') return pathname === '/';
  return pathname.startsWith(target);
}

export function GlassShell({
  navItems,
  heading = null,
  terminal = false,
  dark,
  displayName,
  email,
  initials,
  online,
  presentationActive,
  motionReduced,
  mainRef,
  onToggleTheme,
  onTogglePresentation,
  onToggleMotion,
  onLogout,
  children,
}: GlassShellProps) {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const firstName = displayName.split(/\s+/)[0];
  const today = formatInAppTimeZone(new Date(), { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => {
    if (!menuOpen) return undefined;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        setMenuOpen(false);
        avatarRef.current?.focus();
        return;
      }
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !avatarRef.current?.contains(target)) setMenuOpen(false);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', close);
    };
  }, [menuOpen]);

  // Pointer-following highlight on every glass card (--mx / --my), one listener.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.lg-root');
    if (!root) return undefined;
    const move = (event: PointerEvent) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>('.lg-glass');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    };
    root.addEventListener('pointermove', move, { passive: true });
    return () => root.removeEventListener('pointermove', move);
  }, []);

  const themeLabel = dark ? 'Usar tema claro' : 'Usar tema escuro';
  const toggleTheme = (event: React.MouseEvent) => onToggleTheme({ x: event.clientX, y: event.clientY });

  return (
    <SearchContext.Provider value={{ query, setQuery }}>
      <div className="lg-root">
        <LiquidGlassFilter />
        <div className="lg-backdrop" aria-hidden="true">
          <span className="lg-blob lg-blob-1" />
          <span className="lg-blob lg-blob-2" />
          <span className="lg-blob lg-blob-3" />
          <span className="lg-grain" />
        </div>
        <a href="#main-content" className="skip-link">Pular para o conteúdo</a>

        <nav className="lg-sidebar lg-liquid" aria-label="Navegação principal">
          <NavLink to="/" className="lg-side-logo" aria-label="Curitiba Empreiteira, visão geral">
            <BrandMark />
          </NavLink>
          <div className="lg-side-links">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(location.pathname, item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="lg-side-btn"
                  data-active={active}
                  aria-current={active ? 'page' : undefined}
                  aria-label={item.label}
                  data-tip={item.label}
                >
                  <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
                </NavLink>
              );
            })}
          </div>
          <div className="lg-side-foot">
            <button
              type="button"
              className="lg-side-btn"
              onClick={onTogglePresentation}
              aria-pressed={presentationActive}
              aria-label={presentationActive ? 'Encerrar apresentação' : 'Modo apresentação'}
              data-tip={presentationActive ? 'Encerrar apresentação' : 'Modo apresentação'}
            >
              <MonitorPlay size={19} aria-hidden="true" />
            </button>
            <button type="button" className="lg-side-btn" onClick={toggleTheme} aria-label={themeLabel} data-tip={themeLabel}>
              {dark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
            </button>
          </div>
        </nav>

        <div className="lg-workspace">
          <header className="lg-topbar lg-glass">
            <div className="lg-greet">
              <strong>{greeting()}, {firstName}</strong>
              <span>{today}{!online && <em className="lg-offline"> · sem conexão</em>}</span>
            </div>
            {location.pathname === '/' && <label className="lg-search">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Buscar funcionário ou obra nos pontos de hoje</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar funcionário ou obra"
                autoComplete="off"
              />
            </label>}
            <div className="lg-top-actions">
              <button type="button" className="lg-icon-btn lg-liquid" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
                {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
              </button>
              <div className="lg-account">
                <button
                  ref={avatarRef}
                  type="button"
                  className="lg-avatar"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-controls={menuId}
                  aria-label={`Conta de ${displayName}`}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  {initials || 'OP'}
                </button>
                {menuOpen && (
                  <div ref={menuRef} id={menuId} className="lg-menu lg-glass" role="menu" aria-label="Conta">
                    <div className="lg-menu-head">
                      <strong>{displayName}</strong>
                      <small>{email ?? 'Acesso corporativo'}</small>
                    </div>
                    <button type="button" role="menuitem" onClick={() => { onToggleMotion(); setMenuOpen(false); }}>
                      <Sparkles size={16} aria-hidden="true" /> {motionReduced ? 'Ativar animações' : 'Reduzir animações'}
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void onLogout(); }}>
                      <LogOut size={16} aria-hidden="true" /> Encerrar sessão
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main
            ref={mainRef}
            id="main-content"
            tabIndex={-1}
            className={terminal ? 'lg-main app-main app-main-terminal' : 'lg-main'}
            data-route={location.pathname}
          >
            <div key={location.pathname} className="route-content lg-route">
              {heading && (
                <section className="lg-page-head lg-glass">
                  <div>
                    <span className="lg-eyebrow">{heading.eyebrow}</span>
                    <h1>{heading.title}</h1>
                    <p>{heading.description}</p>
                  </div>
                  {!online && <span className="lg-chip" data-tone="neg">Sem conexão</span>}
                </section>
              )}
              {children}
            </div>
          </main>
        </div>
      </div>
    </SearchContext.Provider>
  );
}

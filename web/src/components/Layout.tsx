import {
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  ClipboardList,
  HardDrive,
  LogOut,
  Menu,
  MoreHorizontal,
  Moon,
  ScrollText,
  Sparkles,
  Sun,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { moveIndicator } from '../animations/motion';
import { useAuth } from '../auth/AuthContext';
import { ALL_ROLES, roleForUser, type AppRole } from '../auth/permissions';
import { BrandMark } from './BrandMark';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: AppRole[];
}
const navItems: NavItem[] = [
  { to: '/', label: 'Visão geral', icon: BarChart3, roles: ['SUPER_ADMIN', 'RH', 'GESTOR_OBRA', 'SUPERVISOR'] },
  { to: '/terminal-facial', label: 'Ponto automático', icon: Camera, roles: ALL_ROLES },
  { to: '/funcionarios', label: 'Funcionários', icon: Users, roles: ['SUPER_ADMIN', 'RH', 'GESTOR_OBRA', 'SUPERVISOR'] },
  { to: '/obras', label: 'Obras', icon: Building2, roles: ['SUPER_ADMIN', 'RH', 'GESTOR_OBRA', 'SUPERVISOR'] },
  { to: '/dispositivos', label: 'Câmeras', icon: HardDrive, roles: ['SUPER_ADMIN', 'GESTOR_OBRA'] },
  { to: '/relatorios', label: 'Relatórios', icon: ClipboardList, roles: ['SUPER_ADMIN', 'RH', 'GESTOR_OBRA'] },
  { to: '/auditoria', label: 'Auditoria', icon: ScrollText, roles: ['SUPER_ADMIN', 'RH'] },
];

const pageCopy: Record<string, { title: string; description: string; eyebrow: string }> = {
  '/': {
    title: 'Visão geral',
    description: 'Presença, registros e disponibilidade de toda a operação em um só lugar.',
    eyebrow: 'Central operacional',
  },
  '/terminal-facial': {
    title: 'Ponto automático',
    description: 'Terminal autônomo de reconhecimento e registro.',
    eyebrow: 'Operação em campo',
  },
  '/funcionarios': {
    title: 'Funcionários',
    description: 'Equipe, vínculos e cadastros biométricos.',
    eyebrow: 'Gestão de pessoas',
  },
  '/obras': {
    title: 'Obras',
    description: 'Locais de trabalho, responsáveis e áreas permitidas.',
    eyebrow: 'Estrutura operacional',
  },
  '/dispositivos': {
    title: 'Câmeras',
    description: 'Fontes de vídeo e disponibilidade dos equipamentos.',
    eyebrow: 'Infraestrutura',
  },
  '/relatorios': {
    title: 'Relatórios',
    description: 'Consolide registros para conferência e fechamento.',
    eyebrow: 'Inteligência de dados',
  },
  '/auditoria': {
    title: 'Auditoria',
    description: 'Histórico das operações sensíveis realizadas no sistema.',
    eyebrow: 'Segurança e rastreabilidade',
  },
};

interface LayoutProps {
  dark: boolean;
  onLogout: () => Promise<void>;
  onToggleTheme: (origin?: { x: number; y: number }) => void;
  children: React.ReactNode;
}

function isActivePath(pathname: string, target: string) {
  if (target === '/') return pathname === '/';
  return pathname.startsWith(target);
}

export function Layout({ dark, onLogout, onToggleTheme, children }: LayoutProps) {
  const location = useLocation();
  const { user } = useAuth();
  const userRole = roleForUser(user);
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => item.roles.includes(userRole)),
    [userRole],
  );
  const mobileNavItems = visibleNavItems.slice(0, 4);
  const current = pageCopy[location.pathname] ?? pageCopy['/'];
  const isTerminal = location.pathname === '/terminal-facial';
  const [online, setOnline] = useState(navigator.onLine);
  const [motionReduced, setMotionReduced] = useState(() => localStorage.getItem('motion-preference') === 'reduced');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const sidebarNavRef = useRef<HTMLElement>(null);
  const sidebarIndicatorRef = useRef<HTMLSpanElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const mobileIndicatorRef = useRef<HTMLSpanElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);
  const mobileMenuOpenerRef = useRef<HTMLElement | null>(null);

  const openMobileMenu = useCallback(() => {
    mobileMenuOpenerRef.current = document.activeElement as HTMLElement | null;
    setMobileMenuOpen(true);
  }, []);

  const closeMobileMenu = useCallback((restoreFocus = true) => {
    setMobileMenuOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => mobileMenuOpenerRef.current?.focus());
  }, []);

  const displayName = useMemo(() => {
    const metadataName = user?.user_metadata?.name;
    if (typeof metadataName === 'string' && metadataName.trim()) return metadataName.trim();
    return user?.email?.split('@')[0] || 'Operador';
  }, [user]);

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  const currentDate = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date());

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  useEffect(() => {
    const mode = motionReduced ? 'reduced' : 'full';
    document.documentElement.dataset.motionMode = mode;
    localStorage.setItem('motion-preference', mode);
    return () => { delete document.documentElement.dataset.motionMode; };
  }, [motionReduced]);

  useEffect(() => {
    setMobileMenuOpen(false);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    sidebarCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileMenu();
        return;
      }
      if (event.key !== 'Tab' || !sidebarRef.current) return;
      const focusable = Array.from(sidebarRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [closeMobileMenu, mobileMenuOpen]);

  useLayoutEffect(() => {
    let sidebarAnimation: ReturnType<typeof moveIndicator>;
    let mobileAnimation: ReturnType<typeof moveIndicator>;
    const frame = window.requestAnimationFrame(() => {
      const sidebarTarget = sidebarNavRef.current?.querySelector<HTMLElement>('.sidebar-link[data-active="true"]');
      const mobileTarget = mobileNavRef.current?.querySelector<HTMLElement>('a[data-active="true"], button[data-active="true"]');
      if (sidebarIndicatorRef.current && sidebarTarget) sidebarAnimation = moveIndicator(sidebarIndicatorRef.current, sidebarTarget, 'y');
      if (mobileIndicatorRef.current && mobileTarget) mobileAnimation = moveIndicator(mobileIndicatorRef.current, mobileTarget, 'x');
    });
    return () => {
      window.cancelAnimationFrame(frame);
      sidebarAnimation?.cancel();
      mobileAnimation?.cancel();
    };
  }, [location.pathname, mobileMenuOpen]);

  const moreActive = visibleNavItems.slice(4).some((item) => isActivePath(location.pathname, item.to));

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Pular para o conteúdo</a>

      <aside ref={sidebarRef} className="app-sidebar" data-open={mobileMenuOpen} aria-hidden={!mobileMenuOpen}>
        <div className="sidebar-brand-row">
          <NavLink to="/" className="brand-lockup">
            <BrandMark />
            <span>
              <strong>Curitiba Empreiteira</strong>
            </span>
          </NavLink>
          <button
            ref={sidebarCloseRef}
            className="sidebar-close"
            type="button"
            onClick={() => closeMobileMenu()}
            aria-label="Fechar menu"
          >
            <X size={19} />
          </button>
        </div>

        <div className="sidebar-section-label">Operação</div>
        <nav ref={sidebarNavRef} className="sidebar-nav" aria-label="Navegação principal">
          <span ref={sidebarIndicatorRef} className="sidebar-active-indicator" aria-hidden="true" />
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(location.pathname, item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className="sidebar-link"
                data-active={active}
                aria-current={active ? 'page' : undefined}
              >
                <span className="sidebar-link-icon"><Icon size={18} strokeWidth={1.9} /></span>
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button onClick={() => setMotionReduced((current) => !current)} className="sidebar-theme" type="button">
            <Sparkles size={17} />
            {motionReduced ? 'Ativar animações' : 'Reduzir animações'}
          </button>
          <button onClick={(event) => onToggleTheme({ x: event.clientX, y: event.clientY })} className="sidebar-theme" type="button">
            {dark ? <Sun size={17} /> : <Moon size={17} />}
            {dark ? 'Usar tema claro' : 'Usar tema escuro'}
          </button>
          <button onClick={() => void onLogout()} className="sidebar-theme" type="button">
            <LogOut size={17} />
            Encerrar sessão
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Fechar menu"
          onClick={() => closeMobileMenu()}
        />
      )}

      <div className="app-workspace">
        <header className="app-topbar">
          <button
            className="topbar-menu"
            type="button"
            onClick={openMobileMenu}
            aria-label="Abrir menu"
            aria-expanded={mobileMenuOpen}
          >
            <Menu size={20} />
          </button>
          <div className="topbar-brand-mobile">
            <BrandMark />
          </div>
          <NavLink to="/" className="topbar-brand-desktop" aria-label="Ir para a visão geral">
            <BrandMark />
            <span>
              <strong>Curitiba Empreiteira</strong>
              <small>Controle de presença</small>
            </span>
          </NavLink>
          <div className="topbar-page-context min-w-0">
            <p className="topbar-context">{current.eyebrow}</p>
            <strong className="topbar-title">{current.title}</strong>
          </div>
          <nav className="desktop-primary-nav" aria-label="Navegação principal">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(location.pathname, item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  data-active={active}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={17} strokeWidth={1.9} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
          <div className="topbar-actions">
            <span className="topbar-date">
              <CalendarDays size={15} />
              {currentDate}
            </span>
            <button onClick={(event) => onToggleTheme({ x: event.clientX, y: event.clientY })} className="topbar-icon" type="button" aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}>
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={() => setMotionReduced((current) => !current)}
              className="topbar-icon"
              type="button"
              aria-label={motionReduced ? 'Ativar animações completas' : 'Reduzir animações'}
              aria-pressed={!motionReduced}
              title={motionReduced ? 'Ativar animações completas' : 'Reduzir animações'}
            >
              <Sparkles size={18} />
            </button>
            <div className="topbar-profile" title={user?.email ?? undefined}>
              <span className="topbar-avatar">{initials || 'OP'}</span>
              <span>
                <strong>{displayName}</strong>
                <small>{user?.email ?? 'Acesso corporativo'}</small>
              </span>
            </div>
          </div>
        </header>

        <main ref={mainRef} id="main-content" tabIndex={-1} className={isTerminal ? 'app-main app-main-terminal' : 'app-main'}>
          <div key={location.pathname} className="route-content">
            {!isTerminal && (
              <section className="page-heading page-assembly-heading">
                <div>
                  <span className="page-heading-kicker">{current.eyebrow}</span>
                  <h1>{current.title}</h1>
                  <p>{current.description}</p>
                </div>
                {!online && (
                  <span className="page-status is-offline">
                    <span className="status-dot" />
                    Sem conexão
                  </span>
                )}
              </section>
            )}
            {children}
          </div>
        </main>
      </div>

      <nav ref={mobileNavRef} className="mobile-nav" aria-label="Navegação móvel">
        <span ref={mobileIndicatorRef} className="mobile-active-indicator" aria-hidden="true" />
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(location.pathname, item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              data-active={active}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={19} strokeWidth={1.9} />
              <span>{item.label.split(' ')[0]}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          data-active={moreActive || mobileMenuOpen}
          onClick={openMobileMenu}
          aria-label="Abrir mais opções"
        >
          <MoreHorizontal size={20} strokeWidth={1.9} />
          <span>Mais</span>
        </button>
      </nav>
    </div>
  );
}

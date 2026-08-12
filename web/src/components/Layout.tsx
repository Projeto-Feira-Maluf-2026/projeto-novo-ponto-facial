import {
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  ClipboardList,
  HardDrive,
  LogOut,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

interface NavItem {
  to: string;
  label: string;
  code: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Painel', code: '01', icon: BarChart3 },
  { to: '/terminal-facial', label: 'Ponto facial', code: '02', icon: Camera },
  { to: '/funcionarios', label: 'Funcionários', code: '03', icon: Users },
  { to: '/obras', label: 'Obras', code: '04', icon: Building2 },
  { to: '/dispositivos', label: 'Câmeras', code: '05', icon: HardDrive },
  { to: '/relatorios', label: 'Relatórios', code: '06', icon: ClipboardList },
];

const pageCopy: Record<string, { title: string; description: string; section: string; code: string }> = {
  '/': { title: 'Centro de controle', description: 'Leitura consolidada da operação de hoje.', section: 'OPERAÇÃO', code: '01' },
  '/terminal-facial': { title: 'Ponto facial', description: 'Reconhecimento e registro automático em campo.', section: 'TERMINAL', code: '02' },
  '/funcionarios': { title: 'Funcionários', description: 'Equipe e cadastros biométricos.', section: 'PESSOAS', code: '03' },
  '/obras': { title: 'Obras', description: 'Canteiros, responsáveis e perímetros.', section: 'ESTRUTURA', code: '04' },
  '/dispositivos': { title: 'Câmeras', description: 'Fontes de vídeo ligadas à operação.', section: 'DISPOSITIVOS', code: '05' },
  '/relatorios': { title: 'Relatórios', description: 'Exportação e conferência dos registros.', section: 'DADOS', code: '06' },
};

interface LayoutProps {
  dark: boolean;
  onLogout: () => Promise<void>;
  onToggleTheme: () => void;
  children: React.ReactNode;
}

function isActivePath(pathname: string, target: string) {
  return target === '/' ? pathname === '/' : pathname.startsWith(target);
}

export function Layout({ dark, onLogout, onToggleTheme, children }: LayoutProps) {
  const location = useLocation();
  const { user } = useAuth();
  const current = pageCopy[location.pathname] ?? pageCopy['/'];
  const isTerminal = location.pathname === '/terminal-facial';
  const [online, setOnline] = useState(navigator.onLine);
  const [menuOpen, setMenuOpen] = useState(false);

  const displayName = useMemo(() => {
    const name = user?.user_metadata?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
    return user?.email?.split('@')[0] || 'Operador';
  }, [user]);

  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const today = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const previous = document.body.style.overflow;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape); };
  }, [menuOpen]);

  return (
    <div className="ops-shell">
      <a href="#main-content" className="skip-link">Pular para o conteúdo</a>

      <aside className="ops-navigation" data-open={menuOpen}>
        <div className="ops-rail">
          <NavLink to="/" className="ops-symbol" aria-label="Curitiba Empreiteira">CE</NavLink>
          <div className="ops-rail-line" />
          <span className="ops-rail-code">CTRL<br />02.26</span>
          <div className="ops-rail-actions">
            <button type="button" onClick={onToggleTheme} aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}>
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button type="button" onClick={() => void onLogout()} aria-label="Encerrar sessão"><LogOut size={18} /></button>
          </div>
        </div>

        <div className="ops-menu">
          <div className="ops-menu-header">
            <span><strong>Curitiba</strong><small>Empreiteira</small></span>
            <button className="ops-menu-close" type="button" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X size={19} /></button>
          </div>

          <span className="ops-menu-label">NAVEGAÇÃO</span>
          <nav aria-label="Navegação principal">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} viewTransition data-active={isActivePath(location.pathname, item.to)}>
                  <span className="ops-nav-code">{item.code}</span>
                  <Icon size={18} strokeWidth={1.7} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="ops-menu-status">
            <ShieldCheck size={18} />
            <span><strong>Ambiente protegido</strong><small>Controle biométrico restrito</small></span>
          </div>
        </div>
      </aside>

      {menuOpen && <button className="ops-scrim" type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}

      <div className="ops-workspace">
        <header className="ops-topbar">
          <button className="ops-menu-trigger" type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu" aria-expanded={menuOpen}>
            <Menu size={20} />
          </button>
          <div className="ops-topbar-title">
            <span>{current.section} / {current.code}</span>
            <strong>{current.title}</strong>
          </div>
          <div className="ops-topbar-meta">
            <span className="ops-date"><CalendarDays size={15} />{today}</span>
            <span className="ops-connection" data-online={online}><i />{online ? 'CONECTADO' : 'OFFLINE'}</span>
            <div className="ops-user">
              <span>{initials || 'OP'}</span>
              <div><strong>{displayName}</strong><small>{user?.email ?? 'Acesso corporativo'}</small></div>
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className={isTerminal ? 'ops-main ops-main-terminal' : 'ops-main'}>
          {!isTerminal && (
            <header className="ops-page-header">
              <div className="ops-page-index"><span>{current.code}</span><i /></div>
              <div><span>{current.section}</span><h1>{current.title}</h1><p>{current.description}</p></div>
              <div className="ops-page-state" data-online={online}><span />{online ? 'SISTEMA OPERACIONAL' : 'SEM CONEXÃO'}</div>
            </header>
          )}
          {children}
        </main>

        <nav className="ops-mobile-nav" aria-label="Navegação móvel">
          {navItems.slice(0, 4).map((item) => {
            const Icon = item.icon;
            return <NavLink key={item.to} to={item.to} data-active={isActivePath(location.pathname, item.to)}><Icon size={19} /><span>{item.label.split(' ')[0]}</span></NavLink>;
          })}
          <button type="button" onClick={() => setMenuOpen(true)}><Menu size={19} /><span>Menu</span></button>
        </nav>
      </div>
    </div>
  );
}

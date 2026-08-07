import {
  BarChart3,
  Building2,
  Camera,
  ClipboardList,
  HardDrive,
  Moon,
  ShieldCheck,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Visão geral', icon: BarChart3 },
  { to: '/terminal-facial', label: 'Ponto automático', icon: Camera },
  { to: '/funcionarios', label: 'Funcionários', icon: Users },
  { to: '/obras', label: 'Obras', icon: Building2 },
  { to: '/dispositivos', label: 'Câmeras', icon: HardDrive },
  { to: '/relatorios', label: 'Relatórios', icon: ClipboardList },
];

const pageCopy: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Visão geral',
    description: 'Acompanhe presença, registros e disponibilidade da operação.',
  },
  '/terminal-facial': {
    title: 'Ponto automático',
    description: 'Terminal autônomo de reconhecimento e registro.',
  },
  '/funcionarios': {
    title: 'Funcionários',
    description: 'Equipe, vínculos e cadastros biométricos.',
  },
  '/obras': {
    title: 'Obras',
    description: 'Locais de trabalho, responsáveis e áreas permitidas.',
  },
  '/dispositivos': {
    title: 'Câmeras',
    description: 'Fontes de vídeo e disponibilidade dos equipamentos.',
  },
  '/relatorios': {
    title: 'Relatórios',
    description: 'Consolide registros para conferência e fechamento.',
  },
};

interface LayoutProps {
  dark: boolean;
  onToggleTheme: () => void;
  children: React.ReactNode;
}

function isActivePath(pathname: string, target: string) {
  if (target === '/') return pathname === '/';
  return pathname.startsWith(target);
}

export function Layout({ dark, onToggleTheme, children }: LayoutProps) {
  const location = useLocation();
  const current = pageCopy[location.pathname] ?? pageCopy['/'];
  const isTerminal = location.pathname === '/terminal-facial';
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <NavLink to="/" viewTransition className="brand-lockup">
          <span className="brand-mark">CE</span>
          <span>
            <strong>Curitiba Empreiteira</strong>
            <small>Controle de ponto</small>
          </span>
        </NavLink>

        <div className="sidebar-section-label">Operação</div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(location.pathname, item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                viewTransition
                className="sidebar-link"
                data-active={active}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-security">
            <ShieldCheck size={18} />
            <span>
              <strong>Ambiente protegido</strong>
              <small>Dados biométricos restritos</small>
            </span>
          </div>
          <button onClick={onToggleTheme} className="sidebar-theme" type="button">
            {dark ? <Sun size={17} /> : <Moon size={17} />}
            {dark ? 'Usar tema claro' : 'Usar tema escuro'}
          </button>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="app-topbar">
          <div className="topbar-brand-mobile">
            <span className="brand-mark">CE</span>
          </div>
          <div className="min-w-0">
            <p className="topbar-context">Controle de ponto</p>
            <h1 className="topbar-title">{current.title}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`connection-badge ${online ? 'is-online' : 'is-offline'}`}>
              <span className="connection-dot" />
              {online ? 'Conectado' : 'Sem conexão'}
            </span>
            <button onClick={onToggleTheme} className="topbar-icon" type="button" aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}>
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        <main className={isTerminal ? 'app-main app-main-terminal' : 'app-main'}>
          {!isTerminal && (
            <section className="page-heading">
              <div>
                <h2>{current.title}</h2>
                <p>{current.description}</p>
              </div>
            </section>
          )}
          {children}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navegação móvel">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(location.pathname, item.to);
          return (
            <NavLink key={item.to} to={item.to} viewTransition data-active={active}>
              <Icon size={19} strokeWidth={1.8} />
              <span>{item.label.split(' ')[0]}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

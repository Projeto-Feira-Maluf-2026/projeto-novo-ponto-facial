import {
  BarChart3,
  Building2,
  Camera,
  ClipboardList,
  HardDrive,
  MonitorPlay,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { ALL_ROLES, roleForUser, type AppRole } from '../auth/permissions';
import { GlassShell } from './GlassShell';
import { usePresentationMode } from '../presentation/PresentationContext';

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
];
const presentationNavItem: NavItem = {
  to: '/apresentacao',
  label: 'Apresentação',
  icon: MonitorPlay,
  roles: ['SUPER_ADMIN', 'RH', 'GESTOR_OBRA', 'SUPERVISOR'],
};

const pageCopy: Record<string, { title: string; description: string; eyebrow: string }> = {
  '/': {
    title: 'Visão geral',
    description: 'Como está o dia nas obras, num lugar só.',
    eyebrow: 'Resumo do dia',
  },
  '/terminal-facial': {
    title: 'Ponto automático',
    description: 'Olhe para a câmera e o ponto é registrado sozinho.',
    eyebrow: 'Na obra',
  },
  '/funcionarios': {
    title: 'Funcionários',
    description: 'Quem trabalha em cada obra e quem já cadastrou o rosto.',
    eyebrow: 'Pessoas',
  },
  '/obras': {
    title: 'Obras',
    description: 'Os locais de trabalho, quem cuida de cada um e o movimento de hoje.',
    eyebrow: 'Locais',
  },
  '/dispositivos': {
    title: 'Câmeras',
    description: 'As câmeras que leem o ponto e se cada uma está funcionando.',
    eyebrow: 'Equipamentos',
  },
  '/relatorios': {
    title: 'Relatórios',
    description: 'Baixe os pontos do período para conferir e fechar a folha.',
    eyebrow: 'Fechamento',
  },
  '/apresentacao': {
    title: 'Modo apresentação',
    description: 'Tudo o que você precisa para mostrar o projeto na feira.',
    eyebrow: 'Feira de tecnologia',
  },
};

interface LayoutProps {
  dark: boolean;
  onLogout: () => Promise<void>;
  onToggleTheme: (origin?: { x: number; y: number }) => void;
  children: React.ReactNode;
}


export function Layout({ dark, onLogout, onToggleTheme, children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const presentation = usePresentationMode();
  const userRole = roleForUser(user);
  const visibleNavItems = useMemo(() => {
    const items = navItems.filter((item) => item.roles.includes(userRole));
    if (presentation.active && presentationNavItem.roles.includes(userRole)) items.push(presentationNavItem);
    return items;
  }, [presentation.active, userRole]);
  const current = pageCopy[location.pathname] ?? pageCopy['/'];
  const isTerminal = location.pathname === '/terminal-facial';
  const [online, setOnline] = useState(navigator.onLine);
  const [motionReduced, setMotionReduced] = useState(() => localStorage.getItem('motion-preference') === 'reduced');
  const mainRef = useRef<HTMLElement>(null);

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
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const togglePresentation = () => {
    if (presentation.active) {
      presentation.stop();
      if (location.pathname === '/apresentacao') navigate('/');
      return;
    }
    presentation.start();
    navigate('/apresentacao');
  };

  // Every screen uses the liquid glass shell; the overview brings its own hero
  // and the facial terminal uses the whole width for the camera.
  return (
    <GlassShell
      navItems={visibleNavItems}
      heading={location.pathname === '/' || isTerminal ? null : current}
      terminal={isTerminal}
      dark={dark}
      displayName={displayName}
      email={user?.email}
      initials={initials}
      online={online}
      presentationActive={presentation.active}
      motionReduced={motionReduced}
      mainRef={mainRef}
      onToggleTheme={onToggleTheme}
      onTogglePresentation={togglePresentation}
      onToggleMotion={() => setMotionReduced((value) => !value)}
      onLogout={onLogout}
    >
      {children}
    </GlassShell>
  );
}

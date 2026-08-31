import { lazy, Suspense, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import { userHasRole, type AppRole } from './auth/permissions';
import { Layout } from './components/Layout';
import { BrandMark } from './components/BrandMark';
import { useUtilityEffects } from './effects/useUtilityEffects';
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const DevicesPage = lazy(() => import('./pages/DevicesPage').then((module) => ({ default: module.DevicesPage })));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage').then((module) => ({ default: module.EmployeesPage })));
const FacialTerminalPage = lazy(() => import('./pages/FacialTerminalPage').then((module) => ({ default: module.FacialTerminalPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const PresentationPage = lazy(() => import('./pages/PresentationPage').then((module) => ({ default: module.PresentationPage })));
const PresentationResultPage = lazy(() => import('./pages/PresentationResultPage').then((module) => ({ default: module.PresentationResultPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const WorksitesPage = lazy(() => import('./pages/WorksitesPage').then((module) => ({ default: module.WorksitesPage })));

function RoleRoute({ roles, children }: { roles: AppRole[]; children: React.ReactNode }) {
  const { user } = useAuth();
  return userHasRole(user, roles) ? children : <Navigate to="/terminal-facial" replace />;
}

function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading-label">Preparando área de trabalho</span>
      <span className="route-loading-line" aria-hidden="true" />
      <span className="route-loading-line is-short" aria-hidden="true" />
    </div>
  );
}

export default function App() {
  useUtilityEffects();
  const { loading, session, signOut, user } = useAuth();
  const privilegedRoles: AppRole[] = ['SUPER_ADMIN', 'RH', 'GESTOR_OBRA', 'SUPERVISOR'];
  const initialPath = userHasRole(user, privilegedRoles) ? '/' : '/terminal-facial';
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  const toggleTheme = (origin?: { x: number; y: number }) => {
    const nextDark = !dark;
    const applyTheme = () => {
      document.documentElement.classList.toggle('dark', nextDark);
      localStorage.setItem('theme', nextDark ? 'dark' : 'light');
      flushSync(() => setDark(nextDark));
    };
    const transitionDocument = document as Document & {
      startViewTransition?: (callback: () => void) => {
        ready: Promise<void>;
        finished: Promise<void>;
      };
    };

    if (!transitionDocument.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      applyTheme();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    document.documentElement.dataset.themeTransition = 'true';
    const transition = transitionDocument.startViewTransition(applyTheme);
    void transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
        },
        {
          duration: 620,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
        } as KeyframeAnimationOptions,
      );
    }).catch(() => undefined);
    void transition.finished.finally(() => {
      delete document.documentElement.dataset.themeTransition;
    }).catch(() => {
      delete document.documentElement.dataset.themeTransition;
    });
  };

  if (loading) {
    return (
      <main className="login-page" aria-label="Carregando sessão">
        <section className="auth-loading-card" role="status" aria-live="polite">
          <BrandMark className="auth-loading-mark" title="Curitiba Empreiteira" />
          <div className="auth-loading-spinner" aria-hidden="true" />
          <h1>Preparando seu acesso</h1>
          <p>Validando a sessão.</p>
        </section>
      </main>
    );
  }

  const allowDevelopmentPresentationPreview = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('preview') === '1';

  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
      <Route path="/login" element={session ? <Navigate to={initialPath} replace /> : <LoginPage />} />
      <Route
        path="/apresentacao/resumo"
        element={session || allowDevelopmentPresentationPreview
          ? <PresentationResultPage />
          : <Navigate to="/login" replace />}
      />
      <Route
        path="/*"
        element={
          session ? <Layout
            dark={dark}
            onLogout={signOut}
            onToggleTheme={toggleTheme}
          >
            <Routes>
              <Route index element={<RoleRoute roles={privilegedRoles}><DashboardPage /></RoleRoute>} />
              <Route path="funcionarios" element={<RoleRoute roles={privilegedRoles}><EmployeesPage /></RoleRoute>} />
              <Route path="obras" element={<RoleRoute roles={privilegedRoles}><WorksitesPage /></RoleRoute>} />
              <Route path="dispositivos" element={<RoleRoute roles={['SUPER_ADMIN', 'GESTOR_OBRA']}><DevicesPage /></RoleRoute>} />
              <Route path="terminal-facial" element={<FacialTerminalPage />} />
              <Route path="relatorios" element={<RoleRoute roles={['SUPER_ADMIN', 'RH', 'GESTOR_OBRA']}><ReportsPage /></RoleRoute>} />
              <Route path="auditoria" element={<RoleRoute roles={['SUPER_ADMIN', 'RH']}><Navigate to="/relatorios?view=audit" replace /></RoleRoute>} />
              <Route path="apresentacao" element={<RoleRoute roles={privilegedRoles}><PresentationPage /></RoleRoute>} />
              <Route path="*" element={<Navigate to={initialPath} replace />} />
            </Routes>
          </Layout> : <Navigate to="/login" replace />
        }
      />
      </Routes>
    </Suspense>
  );
}

import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const DevicesPage = lazy(() => import('./pages/DevicesPage').then((module) => ({ default: module.DevicesPage })));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage').then((module) => ({ default: module.EmployeesPage })));
const FacialTerminalPage = lazy(() => import('./pages/FacialTerminalPage').then((module) => ({ default: module.FacialTerminalPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const WorksitesPage = lazy(() => import('./pages/WorksitesPage').then((module) => ({ default: module.WorksitesPage })));

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
  const { loading, session, signOut } = useAuth();
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  if (loading) {
    return (
      <main className="login-page" aria-label="Carregando sessão">
        <section className="auth-loading-card" role="status" aria-live="polite">
          <div className="auth-loading-mark">CE</div>
          <div className="auth-loading-spinner" aria-hidden="true" />
          <h1>Preparando seu acesso</h1>
          <p>Validando a sessão.</p>
        </section>
      </main>
    );
  }

  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/*"
        element={
          session ? <Layout
            dark={dark}
            onLogout={signOut}
            onToggleTheme={() => setDark((value) => !value)}
          >
            <Routes>
              <Route index element={<DashboardPage />} />
              <Route path="funcionarios" element={<EmployeesPage />} />
              <Route path="obras" element={<WorksitesPage />} />
              <Route path="dispositivos" element={<DevicesPage />} />
              <Route path="terminal-facial" element={<FacialTerminalPage />} />
              <Route path="relatorios" element={<ReportsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout> : <Navigate to="/login" replace />
        }
      />
      </Routes>
    </Suspense>
  );
}

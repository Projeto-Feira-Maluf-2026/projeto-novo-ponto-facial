import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { FacialTerminalPage } from './pages/FacialTerminalPage';
import { LoginPage } from './pages/LoginPage';
import { ReportsPage } from './pages/ReportsPage';
import { WorksitesPage } from './pages/WorksitesPage';

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <Layout dark={dark} onToggleTheme={() => setDark((value) => !value)}>
            <Routes>
              <Route index element={<DashboardPage />} />
              <Route path="funcionarios" element={<EmployeesPage />} />
              <Route path="obras" element={<WorksitesPage />} />
              <Route path="dispositivos" element={<DevicesPage />} />
              <Route path="terminal-facial" element={<FacialTerminalPage />} />
              <Route path="relatorios" element={<ReportsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}


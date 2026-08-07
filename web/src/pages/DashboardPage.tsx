import { Activity, AlertTriangle, Building2, Clock3, HardDrive, UserCheck, UserX, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { MetricCard } from '../components/MetricCard';
import { apiClient } from '../services/api';
import type { DashboardMetrics } from '../types/domain';

export function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    apiClient.dashboard().then(setMetrics);
    const timer = window.setInterval(() => apiClient.dashboard().then(setMetrics), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!metrics) {
    return (
      <div className="app-view-transition grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="skeleton h-28" />
        ))}
      </div>
    );
  }

  const peak = Math.max(...metrics.timeline.map((item) => item.records), 1);

  return (
    <div className="app-view-transition space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Funcionários" value={metrics.total_employees} icon={Users} tone="gray" />
        <MetricCard label="Presentes" value={metrics.present_employees} icon={UserCheck} tone="green" />
        <MetricCard label="Ausentes" value={metrics.absent_employees} icon={UserX} tone="red" />
        <MetricCard label="Registros hoje" value={metrics.records_today} icon={Clock3} tone="blue" />
        <MetricCard label="Horas trabalhadas" value={metrics.worked_hours_today.toLocaleString('pt-BR')} icon={Activity} tone="blue" />
        <MetricCard label="Obras ativas" value={metrics.worksites} icon={Building2} tone="gray" />
        <MetricCard label="Dispositivos online" value={metrics.connected_devices} icon={HardDrive} tone="green" />
        <MetricCard label="Alertas antifraude" value={metrics.fraud_alerts} icon={AlertTriangle} tone="red" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="app-card app-view-transition p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Fluxo de registros</h2>
              <p className="text-sm text-steel dark:text-slate-400">Volume por horário operacional</p>
            </div>
            <span className="status-pill status-pill-online">
              <span className="status-dot status-dot-pulse" />
              Tempo real
            </span>
          </div>
          <div className="mt-6 flex h-72 items-end gap-3 rounded-md border border-black/5 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
            {metrics.timeline.map((item, index) => (
              <div key={item.hour} className="flex h-full flex-1 flex-col justify-end gap-2">
                <div
                  className="min-h-2 rounded-t-sm bg-emerald-700 dark:bg-emerald-400"
                  style={{
                    height: `${Math.max(8, (item.records / peak) * 100)}%`,
                    animation: 'card-in 260ms var(--ease-out) both',
                    animationDelay: `${index * 35}ms`,
                  }}
                  title={`${item.records} registros`}
                />
                <div className="text-center text-xs text-steel dark:text-slate-400">{item.hour.slice(0, 5)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="app-card app-view-transition p-5">
          <h2 className="text-base font-semibold">Obras com movimento</h2>
          <div className="mt-5 space-y-4">
            {metrics.by_worksite.map((site) => (
              <div key={site.name}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold">{site.name}</span>
                  <span className="text-steel dark:text-slate-400">{site.records}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div className="h-2 rounded-full bg-emerald-700 dark:bg-emerald-400" style={{ width: `${Math.min(100, (site.records / 500) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

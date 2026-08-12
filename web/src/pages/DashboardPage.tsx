import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Clock3,
  HardDrive,
  Radio,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { MetricCard } from '../components/MetricCard';
import { apiClient } from '../services/api';
import type { DashboardMetrics } from '../types/domain';

export function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const nextMetrics = await apiClient.dashboard();
        if (!active) return;
        setMetrics(nextMetrics);
        setError(false);
      } catch {
        if (active) setError(true);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (error && !metrics) {
    return (
      <div className="app-card empty-state-panel" role="alert">
        <span className="empty-state-icon"><AlertTriangle size={22} /></span>
        <h2>Não foi possível carregar o painel</h2>
        <p>A conexão com a central de dados falhou. Verifique a rede e tente novamente.</p>
        <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={17} />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="app-view-transition dashboard-loading" aria-label="Carregando indicadores">
        <div className="skeleton dashboard-hero-skeleton" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton h-36" />)}
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          <div className="skeleton h-80" />
          <div className="skeleton h-80" />
        </div>
      </div>
    );
  }

  const presenceRate = metrics.total_employees > 0
    ? Math.round((metrics.present_employees / metrics.total_employees) * 100)
    : 0;
  const peak = Math.max(...metrics.timeline.map((item) => item.records), 1);
  const worksitePeak = Math.max(...metrics.by_worksite.map((item) => item.records), 1);

  return (
    <div className="app-view-transition dashboard-stack">
      <section className="operations-hero" aria-labelledby="operations-heading">
        <div className="operations-hero-main">
          <span className="operations-label"><Radio size={14} /> Operação em tempo real</span>
          <h2 id="operations-heading">Sua operação, agora.</h2>
          <p>Presença, dispositivos e alertas consolidados em uma única leitura.</p>

          <div className="presence-summary">
            <div className="presence-summary-copy">
              <span>Taxa de presença</span>
              <strong>{presenceRate}%</strong>
            </div>
            <div
              className="presence-progress"
              role="progressbar"
              aria-label="Taxa de presença"
              aria-valuenow={presenceRate}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${presenceRate}%` }} />
            </div>
          </div>
        </div>

        <div className="operations-signals" aria-label="Sinais operacionais">
          <div className="operations-signal" data-tone="success">
            <span><HardDrive size={18} /></span>
            <div><strong>{metrics.connected_devices}</strong><small>dispositivos online</small></div>
            <ShieldCheck size={17} aria-hidden="true" />
          </div>
          <div className="operations-signal" data-tone="neutral">
            <span><Building2 size={18} /></span>
            <div><strong>{metrics.worksites}</strong><small>obras monitoradas</small></div>
            <ArrowUpRight size={17} aria-hidden="true" />
          </div>
          <div className="operations-signal" data-tone={metrics.fraud_alerts > 0 ? 'danger' : 'success'}>
            <span><AlertTriangle size={18} /></span>
            <div><strong>{metrics.fraud_alerts}</strong><small>alertas antifraude</small></div>
            <span className="signal-status-dot" aria-hidden="true" />
          </div>
        </div>
      </section>

      <section className="dashboard-metrics" aria-label="Indicadores do dia">
        <MetricCard label="Presentes" value={metrics.present_employees} icon={UserCheck} tone="green" hint={`${presenceRate}% da equipe ativa`} />
        <MetricCard label="Ausentes" value={metrics.absent_employees} icon={UserX} tone="red" hint="Sem presença registrada" />
        <MetricCard label="Registros hoje" value={metrics.records_today} icon={Clock3} tone="blue" hint="Entradas e saídas registradas" />
        <MetricCard label="Horas trabalhadas" value={`${metrics.worked_hours_today.toLocaleString('pt-BR')}h`} icon={Activity} tone="amber" hint="Consolidado do dia" />
      </section>

      <section className="dashboard-detail-grid">
        <div className="app-card dashboard-chart-card">
          <div className="section-card-header">
            <div>
              <span className="section-eyebrow">Atividade diária</span>
              <h2>Fluxo de registros</h2>
              <p>Volume de marcações por horário operacional.</p>
            </div>
            <span className="status-pill status-pill-online"><span className="status-dot status-dot-pulse" /> Tempo real</span>
          </div>

          {metrics.timeline.length > 0 ? (
            <div className="timeline-chart" role="img" aria-label="Gráfico de registros por horário">
              {metrics.timeline.map((item, index) => (
                <div key={item.hour} className="timeline-column">
                  <span className="timeline-value">{item.records}</span>
                  <div className="timeline-track">
                    <span
                      className="timeline-bar"
                      style={{
                        height: `${Math.max(7, (item.records / peak) * 100)}%`,
                        animationDelay: `${index * 35}ms`,
                      }}
                    />
                  </div>
                  <span className="timeline-label">{item.hour.slice(0, 5)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="chart-empty">Nenhuma marcação registrada hoje.</div>
          )}
        </div>

        <div className="app-card dashboard-ranking-card">
          <div className="section-card-header">
            <div>
              <span className="section-eyebrow">Distribuição</span>
              <h2>Movimento por obra</h2>
              <p>Locais com registros no período.</p>
            </div>
            <span className="ranking-total"><Users size={16} /> {metrics.total_employees}</span>
          </div>

          <div className="worksite-ranking">
            {metrics.by_worksite.length > 0 ? metrics.by_worksite.map((site, index) => (
              <div className="worksite-ranking-row" key={site.name}>
                <span className="worksite-rank">{String(index + 1).padStart(2, '0')}</span>
                <div className="worksite-ranking-content">
                  <div><strong>{site.name}</strong><span>{site.records} registros</span></div>
                  <div className="worksite-progress" aria-hidden="true">
                    <span style={{ width: `${Math.max(4, (site.records / worksitePeak) * 100)}%` }} />
                  </div>
                </div>
              </div>
            )) : <div className="chart-empty">Nenhuma obra com movimentação hoje.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

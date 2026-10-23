import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Clock3,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { apiClient } from '../services/api';
import type { DashboardMetrics } from '../types/domain';
import { DataFlowCubes } from '../components/SpatialEffects';
import './dashboard.css';

function useAnimatedNumber(value: number, duration = 620) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return undefined;
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [duration, value]);

  return display;
}
export function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

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
  }, [retryKey]);

  if (error && !metrics) {
    return (
      <div className="empty-state-panel" role="alert">
        <span className="empty-state-code">CONEXÃO / 01</span>
        <AlertTriangle size={26} />
        <h2>Não conseguimos carregar os números</h2>
        <p>Pode ser a internet ou o servidor. Você continua conectado; tente de novo em instantes.</p>
        <button className="btn btn-primary" type="button" onClick={() => setRetryKey((key) => key + 1)}>
          <RefreshCw size={17} /> Tentar novamente
        </button>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="dashboard-loading" aria-label="Carregando indicadores" role="status">
        <div className="skeleton dashboard-brief-skeleton" />
        <div className="dashboard-loading-grid"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        <div className="dashboard-loading-grid"><div className="skeleton" /><div className="skeleton" /></div>
      </div>
    );
  }

  const presenceRate = metrics.total_employees > 0
    ? Math.round((metrics.present_employees / metrics.total_employees) * 100)
    : 0;
  const peak = Math.max(...metrics.timeline.map((item) => item.records), 1);
  const worksitePeak = Math.max(...metrics.by_worksite.map((item) => item.records), 1);

  return (
    <DashboardContent
      metrics={metrics}
      presenceRate={presenceRate}
      peak={peak}
      worksitePeak={worksitePeak}
    />
  );
}

function DashboardContent({
  metrics,
  presenceRate,
  peak,
  worksitePeak,
}: {
  metrics: DashboardMetrics;
  presenceRate: number;
  peak: number;
  worksitePeak: number;
}) {
  const animatedPresent = useAnimatedNumber(metrics.present_employees);
  const animatedHours = useAnimatedNumber(metrics.worked_hours_today);
  const animatedRecords = useAnimatedNumber(metrics.records_today);
  const worksiteTotal = metrics.by_worksite.reduce((sum, site) => sum + site.records, 0);

  return (
    <div className="app-view-transition operations-board premium-dashboard">
      <section className="dashboard-hero" aria-labelledby="operations-heading">
        <DataFlowCubes />
        <div className="dashboard-hero-copy">
          <h2 id="operations-heading">Hoje, em campo.</h2>
          <p>Quem já chegou, quantas obras estão em andamento e o que pede atenção. Os números se atualizam sozinhos.</p>
          <div className="dashboard-hero-actions">
            <Link to="/terminal-facial" className="btn btn-on-dark">
              Abrir ponto automático <ArrowUpRight size={17} />
            </Link>
          </div>
        </div>

        <div className="dashboard-presence-orbit" aria-label={`${presenceRate}% de presença hoje`}>
          <div className="presence-ring" style={{ '--presence': `${presenceRate * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{presenceRate}<small>%</small></strong><span>chegaram</span></div>
          </div>
          <p><strong>{metrics.present_employees}</strong> de {metrics.total_employees} funcionários já bateram o ponto.</p>
        </div>

        <dl className="dashboard-hero-status">
          <div><Building2 size={17} /><dt>Obras ativas</dt><dd>{metrics.worksites}</dd></div>
          <div><HardDrive size={17} /><dt>Câmeras ligadas</dt><dd>{metrics.connected_devices}</dd></div>
          <div data-alert={metrics.fraud_alerts > 0}><AlertTriangle size={17} /><dt>Alertas para conferir</dt><dd>{metrics.fraud_alerts}</dd></div>
        </dl>
      </section>

      <section className="metric-mosaic dashboard-metrics" aria-label="Indicadores do dia">
        <article className="metric-tile" data-tone="success">
          <span className="metric-icon"><UserCheck size={20} /></span>
          <div>
            <span>Já chegaram</span>
            <strong>{Math.round(animatedPresent).toLocaleString('pt-BR')}</strong>
            <small>{presenceRate}% da equipe bateu o ponto hoje</small>
          </div>
          <span className="metric-meter" aria-hidden="true"><span style={{ width: `${presenceRate}%` }} /></span>
        </article>
        <article className="metric-tile" data-tone={metrics.absent_employees > 0 ? 'warning' : 'neutral'}>
          <span className="metric-icon"><UserX size={20} /></span>
          <div>
            <span>Ainda não chegaram</span>
            <strong>{metrics.absent_employees.toLocaleString('pt-BR')}</strong>
            <small>{metrics.absent_employees ? 'Sem nenhum ponto registrado hoje' : 'Toda a equipe já registrou'}</small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-icon"><ShieldCheck size={20} /></span>
          <div>
            <span>Pontos registrados</span>
            <strong>{Math.round(animatedRecords).toLocaleString('pt-BR')}</strong>
            <small>Entradas, intervalos e saídas de hoje</small>
          </div>
        </article>
        <article className="metric-tile">
          <span className="metric-icon"><Clock3 size={20} /></span>
          <div>
            <span>Horas trabalhadas</span>
            <strong>{animatedHours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}<small>h</small></strong>
            <small>Somadas até agora, ainda parciais</small>
          </div>
        </article>
      </section>

      <section className="operations-analysis">
        <article className="activity-module" aria-labelledby="activity-title">
          <header className="module-heading">
            <div><span>Ritmo do dia</span><h2 id="activity-title">Quando as pessoas bateram o ponto</h2><p>Pontos registrados em cada horário de hoje.</p></div>
          </header>
          {metrics.timeline.length ? (
            <>
              <ActivityBars timeline={metrics.timeline} peak={peak} />
              <table className="sr-only"><caption>Pontos por horário</caption><thead><tr><th>Horário</th><th>Pontos</th></tr></thead><tbody>{metrics.timeline.map((item) => <tr key={item.hour}><td>{item.hour}</td><td>{item.records}</td></tr>)}</tbody></table>
            </>
          ) : <div className="chart-empty">Quando o primeiro ponto do dia for batido, ele aparece aqui.</div>}
        </article>

        <article className="worksite-module" aria-labelledby="worksite-movement-title">
          <header className="module-heading"><div><span>Por obra</span><h2 id="worksite-movement-title">Onde está o movimento</h2><p>Quantos pontos cada obra recebeu hoje.</p></div><Link to="/obras" aria-label="Ver obras"><ArrowUpRight size={18} /></Link></header>
          <div className="worksite-ranking">
            {metrics.by_worksite.length ? metrics.by_worksite.map((site, index) => (
              <div className="worksite-ranking-row" key={site.name}>
                <span className="worksite-rank">{String(index + 1).padStart(2, '0')}</span>
                <div className="worksite-ranking-content">
                  <div>
                    <strong>{site.name}</strong>
                    <span>{site.records.toLocaleString('pt-BR')} pontos · {worksiteTotal ? Math.round((site.records / worksiteTotal) * 100) : 0}%</span>
                  </div>
                  <div className="worksite-progress" aria-hidden="true"><span style={{ width: `${Math.max(4, (site.records / worksitePeak) * 100)}%` }} /></div>
                </div>
              </div>
            )) : <div className="chart-empty">Nenhuma obra teve movimento hoje.</div>}
          </div>
        </article>
      </section>
    </div>
  );
}

function ActivityBars({
  timeline,
  peak,
}: {
  timeline: DashboardMetrics['timeline'];
  peak: number;
}) {
  const peakItem = timeline.reduce((current, item) => (item.records > current.records ? item : current));
  const total = timeline.reduce((sum, item) => sum + item.records, 0);
  const gridSteps = [1, 0.66, 0.33];

  return (
    <div className="activity-bars">
      <div className="activity-chart-summary">
        <span><small>Pontos no dia</small><strong>{total.toLocaleString('pt-BR')}</strong></span>
        <span><small>Horário mais movimentado</small><strong>{peakItem.hour.slice(0, 5)} <i>{peakItem.records.toLocaleString('pt-BR')} pontos</i></strong></span>
      </div>
      <div className="activity-bars-plot" role="img" aria-label={`Pontos por horário. Pico às ${peakItem.hour.slice(0, 5)} com ${peakItem.records} pontos.`}>
        {gridSteps.map((step) => (
          <span key={step} className="activity-bars-grid" style={{ bottom: `${step * 100}%` }} aria-hidden="true">
            <i>{Math.round(peak * step).toLocaleString('pt-BR')}</i>
          </span>
        ))}
        {timeline.map((item) => {
          const isPeak = item.hour === peakItem.hour;
          const fill = Math.max(2, (item.records / peak) * 100);
          return (
            <div
              key={item.hour}
              className="activity-bar"
              style={{ '--fill': `${fill}%` } as React.CSSProperties}
              data-peak={isPeak || undefined}
              tabIndex={0}
              aria-label={`${item.hour.slice(0, 5)}: ${item.records} pontos`}
            >
              <span className="activity-bar-fill" style={{ height: `${fill}%` }}>
                {isPeak && <b className="activity-bar-label">{item.records.toLocaleString('pt-BR')}</b>}
              </span>
              <span className="activity-bar-tip" aria-hidden="true">
                <strong>{item.records.toLocaleString('pt-BR')} pontos</strong>
                <small>às {item.hour.slice(0, 5)}</small>
              </span>
              <span className="activity-bar-hour" aria-hidden="true">{item.hour.slice(0, 5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
        <h2>Central de dados indisponível</h2>
        <p>Não foi possível consultar os indicadores agora. Sua sessão continua ativa.</p>
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
  const operationalAttention = metrics.absent_employees + metrics.fraud_alerts;

  return (
    <DashboardContent
      metrics={metrics}
      presenceRate={presenceRate}
      peak={peak}
      worksitePeak={worksitePeak}
      operationalAttention={operationalAttention}
    />
  );
}

function DashboardContent({
  metrics,
  presenceRate,
  peak,
  worksitePeak,
  operationalAttention,
}: {
  metrics: DashboardMetrics;
  presenceRate: number;
  peak: number;
  worksitePeak: number;
  operationalAttention: number;
}) {
  const animatedPresent = useAnimatedNumber(metrics.present_employees);
  const animatedHours = useAnimatedNumber(metrics.worked_hours_today);
  const animatedRecords = useAnimatedNumber(metrics.records_today);

  return (
    <div className="app-view-transition operations-board premium-dashboard">
      <section className="dashboard-hero" aria-labelledby="operations-heading">
        <div className="dashboard-hero-copy">
          <span className="dashboard-shift-label">Resumo do turno</span>
          <h2 id="operations-heading">Operação de hoje</h2>
          <p>Presença, marcações e disponibilidade atualizadas a cada vinte segundos.</p>
          <div className="dashboard-hero-actions">
            <Link to="/terminal-facial" viewTransition className="btn btn-on-dark">
              Abrir ponto automático <ArrowUpRight size={17} />
            </Link>
          </div>
        </div>

        <div className="dashboard-presence-orbit" aria-label={`${presenceRate}% de presença hoje`}>
          <div className="presence-meter">
            <div className="presence-meter-heading">
              <span>Presença confirmada</span>
              <strong>{presenceRate}<small>%</small></strong>
            </div>
            <div className="presence-meter-track" aria-hidden="true">
              <span style={{ width: `${presenceRate}%` }} />
            </div>
          </div>
          <p><strong>{metrics.present_employees}</strong> de {metrics.total_employees} funcionários já registraram presença.</p>
        </div>

        <dl className="dashboard-hero-status">
          <div><Building2 size={17} /><dt>Obras ativas</dt><dd>{metrics.worksites}</dd></div>
          <div><HardDrive size={17} /><dt>Dispositivos</dt><dd>{metrics.connected_devices}</dd></div>
          <div data-alert={metrics.fraud_alerts > 0}><AlertTriangle size={17} /><dt>Alertas</dt><dd>{metrics.fraud_alerts}</dd></div>
        </dl>
      </section>

      <section className="metric-mosaic" aria-label="Indicadores do dia">
        <article className="metric-tile metric-tile-primary" data-tone="success">
          <span className="metric-icon"><UserCheck size={20} /></span>
          <div><span>Presentes agora</span><strong>{Math.round(animatedPresent)}</strong><small>Equipe confirmada hoje</small></div>
        </article>
        <article className="metric-tile" data-tone={metrics.absent_employees > 0 ? 'warning' : 'neutral'}>
          <span className="metric-icon"><UserX size={20} /></span>
          <div><span>Sem registro</span><strong>{metrics.absent_employees}</strong><small>Funcionários ainda ausentes</small></div>
        </article>
        <article className="metric-tile">
          <span className="metric-icon"><Clock3 size={20} /></span>
          <div><span>Horas consolidadas</span><strong>{animatedHours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}<small>h</small></strong><small>Parcial apurado no dia</small></div>
        </article>
        <article className="metric-tile metric-tile-wide">
          <span className="metric-icon"><ShieldCheck size={20} /></span>
          <div><span>Marcações recebidas</span><strong>{Math.round(animatedRecords)}</strong><small>Entradas, intervalos e saídas</small></div>
          <div className="metric-attention" data-alert={operationalAttention > 0}>
            <strong>{operationalAttention}</strong>
            <span>itens de atenção<br />entre ausências e alertas</span>
          </div>
        </article>
      </section>

      <section className="operations-analysis">
        <article className="activity-module" aria-labelledby="activity-title">
          <header className="module-heading">
            <div><span>Ritmo do dia</span><h2 id="activity-title">Concentração de atividade</h2><p>Volume real de marcações por faixa de horário.</p></div>
          </header>
          {metrics.timeline.length ? (
            <>
              <div className="timeline-chart" role="img" aria-label="Gráfico de registros por horário">
                {metrics.timeline.map((item, index) => (
                  <div key={item.hour} className="timeline-column">
                    <span className="timeline-value">{item.records}</span>
                    <div className="timeline-track"><span className="timeline-bar" style={{ height: `${Math.max(7, (item.records / peak) * 100)}%`, animationDelay: `${index * 35}ms` }} /></div>
                    <span className="timeline-label">{item.hour.slice(0, 5)}</span>
                  </div>
                ))}
              </div>
              <table className="sr-only"><caption>Registros por horário</caption><thead><tr><th>Horário</th><th>Registros</th></tr></thead><tbody>{metrics.timeline.map((item) => <tr key={item.hour}><td>{item.hour}</td><td>{item.records}</td></tr>)}</tbody></table>
            </>
          ) : <div className="chart-empty">O primeiro registro do dia aparecerá aqui.</div>}
        </article>

        <article className="worksite-module" aria-labelledby="worksite-movement-title">
          <header className="module-heading"><div><span>Distribuição</span><h2 id="worksite-movement-title">Movimento por obra</h2><p>Onde a atividade está concentrada.</p></div><Link to="/obras" viewTransition aria-label="Ver obras"><ArrowUpRight size={18} /></Link></header>
          <div className="worksite-ranking">
            {metrics.by_worksite.length ? metrics.by_worksite.map((site, index) => (
              <div className="worksite-ranking-row" key={site.name}>
                <span className="worksite-rank">{String(index + 1).padStart(2, '0')}</span>
                <div className="worksite-ranking-content"><div><strong>{site.name}</strong><span>{site.records} registros</span></div><div className="worksite-progress" aria-hidden="true"><span style={{ width: `${Math.max(4, (site.records / worksitePeak) * 100)}%` }} /></div></div>
              </div>
            )) : <div className="chart-empty">Nenhuma obra teve movimentação hoje.</div>}
          </div>
        </article>
      </section>
    </div>
  );
}

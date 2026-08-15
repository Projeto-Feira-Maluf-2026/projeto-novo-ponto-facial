import {
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
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { apiClient } from '../services/api';
import type { DashboardMetrics } from '../types/domain';

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
        <div className="skeleton dashboard-score-skeleton" />
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
    <div className="app-view-transition operations-board">
      <section className="operations-brief" aria-labelledby="operations-heading">
        <div className="operations-brief-copy">
          <span className="operations-label"><Radio size={14} /> Monitoramento ativo</span>
          <h2 id="operations-heading">A obra em uma leitura.</h2>
          <p>Presença, registros e infraestrutura atualizados a cada vinte segundos.</p>
        </div>
        <div className="operations-availability" aria-label="Disponibilidade operacional">
          <div><HardDrive size={17} /><span><strong>{metrics.connected_devices}</strong> dispositivos conectados</span></div>
          <div><Building2 size={17} /><span><strong>{metrics.worksites}</strong> obras monitoradas</span></div>
          <div data-alert={metrics.fraud_alerts > 0}><AlertTriangle size={17} /><span><strong>{metrics.fraud_alerts}</strong> alertas para conferir</span></div>
        </div>
      </section>

      <section className="daily-scoreboard" aria-labelledby="daily-scoreboard-title">
        <div className="daily-score-main">
          <span id="daily-scoreboard-title">Presença hoje</span>
          <strong>{presenceRate}<small>%</small></strong>
          <div className="presence-progress" role="progressbar" aria-label="Taxa de presença" aria-valuenow={presenceRate} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${presenceRate}%` }} />
          </div>
          <p>{metrics.present_employees} de {metrics.total_employees} funcionários registraram presença.</p>
        </div>
        <dl className="daily-score-details">
          <div data-tone="success"><dt><UserCheck size={17} /> Presentes</dt><dd>{metrics.present_employees}</dd><small>Equipe confirmada</small></div>
          <div data-tone="danger"><dt><UserX size={17} /> Ausentes</dt><dd>{metrics.absent_employees}</dd><small>Sem registro hoje</small></div>
          <div><dt><Clock3 size={17} /> Marcações</dt><dd>{metrics.records_today}</dd><small>Entradas e saídas</small></div>
          <div><dt><ShieldCheck size={17} /> Horas</dt><dd>{metrics.worked_hours_today.toLocaleString('pt-BR')}h</dd><small>Consolidado parcial</small></div>
        </dl>
      </section>

      <section className="operations-analysis">
        <article className="activity-module" aria-labelledby="activity-title">
          <header className="module-heading">
            <div><span>Ritmo do dia</span><h2 id="activity-title">Fluxo de marcações</h2><p>Volume recebido por faixa de horário.</p></div>
            <span className="live-note"><i /> Tempo real</span>
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
          ) : <div className="chart-empty">Nenhuma marcação registrada hoje.</div>}
        </article>

        <article className="worksite-module" aria-labelledby="worksite-movement-title">
          <header className="module-heading"><div><span>Distribuição</span><h2 id="worksite-movement-title">Movimento por obra</h2><p>Locais com registros no período.</p></div><ArrowUpRight size={18} /></header>
          <div className="worksite-ranking">
            {metrics.by_worksite.length ? metrics.by_worksite.map((site, index) => (
              <div className="worksite-ranking-row" key={site.name}>
                <span className="worksite-rank">{String(index + 1).padStart(2, '0')}</span>
                <div className="worksite-ranking-content"><div><strong>{site.name}</strong><span>{site.records} registros</span></div><div className="worksite-progress" aria-hidden="true"><span style={{ width: `${Math.max(4, (site.records / worksitePeak) * 100)}%` }} /></div></div>
              </div>
            )) : <div className="chart-empty">Nenhuma obra com movimentação hoje.</div>}
          </div>
        </article>
      </section>
    </div>
  );
}

import {
  Activity,
  AlertTriangle,
  Building2,
  Clock3,
  HardDrive,
  RefreshCw,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { ConstructionScene3D } from '../components/ConstructionScene3D';
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
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (error && !metrics) {
    return (
      <section className="system-message" role="alert">
        <AlertTriangle size={24} />
        <div><strong>Dados indisponíveis</strong><p>A central não respondeu. Verifique a conexão e tente novamente.</p></div>
        <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}><RefreshCw size={17} /> Recarregar</button>
      </section>
    );
  }

  if (!metrics) {
    return (
      <div className="dashboard-loading" aria-label="Carregando indicadores">
        <div className="skeleton h-80" />
        <div className="grid gap-px sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton h-36" />)}
        </div>
      </div>
    );
  }

  const presenceRate = metrics.total_employees
    ? Math.round((metrics.present_employees / metrics.total_employees) * 100)
    : 0;
  const peak = Math.max(...metrics.timeline.map((item) => item.records), 1);
  const worksitePeak = Math.max(...metrics.by_worksite.map((item) => item.records), 1);

  return (
    <div className="control-dashboard">
      <section className="control-hero">
        <div className="control-briefing">
          <span className="control-kicker">STATUS / HOJE</span>
          <h2>{presenceRate}% da equipe<br />está presente.</h2>
          <p>{metrics.present_employees} de {metrics.total_employees} funcionários com presença registrada.</p>

          <div className="control-progress" role="progressbar" aria-label="Taxa de presença" aria-valuenow={presenceRate} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${presenceRate}%` }} />
            <i style={{ left: `${presenceRate}%` }} />
          </div>
          <div className="control-progress-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100%</span></div>

          <div className="control-signals">
            <div data-state="ok"><HardDrive size={17} /><span><strong>{metrics.connected_devices}</strong> dispositivos ativos</span></div>
            <div data-state="base"><Building2 size={17} /><span><strong>{metrics.worksites}</strong> obras monitoradas</span></div>
            <div data-state={metrics.fraud_alerts ? 'alert' : 'ok'}><AlertTriangle size={17} /><span><strong>{metrics.fraud_alerts}</strong> alertas antifraude</span></div>
          </div>
        </div>

        <div className="control-building">
          <div className="control-building-heading"><span>VISUALIZAÇÃO OPERACIONAL</span><strong>Estrutura monitorada</strong></div>
          <ConstructionScene3D compact />
        </div>
      </section>

      <section className="metric-ledger" aria-label="Indicadores do dia">
        <MetricCard label="Presentes" value={metrics.present_employees} icon={UserCheck} tone="green" hint={`${presenceRate}% da equipe`} />
        <MetricCard label="Ausentes" value={metrics.absent_employees} icon={UserX} tone="red" hint="Sem presença registrada" />
        <MetricCard label="Marcações" value={metrics.records_today} icon={Clock3} tone="blue" hint="Entradas e saídas" />
        <MetricCard label="Horas apuradas" value={`${metrics.worked_hours_today.toLocaleString('pt-BR')}h`} icon={Activity} tone="amber" hint="Consolidado atual" />
      </section>

      <section className="control-data-grid">
        <article className="data-board activity-board">
          <header className="data-board-header">
            <div><span>DADOS / 01</span><h2>Fluxo de marcações</h2><p>Registros distribuídos pelo horário operacional.</p></div>
            <span className="live-marker"><i />TEMPO REAL</span>
          </header>

          {metrics.timeline.length ? (
            <div className="industrial-chart" role="img" aria-label="Gráfico de marcações por horário">
              <div className="industrial-chart-grid" />
              {metrics.timeline.map((item, index) => (
                <div className="industrial-bar-column" key={item.hour}>
                  <span className="industrial-value">{item.records}</span>
                  <div className="industrial-bar-track">
                    <span style={{ height: `${Math.max(5, (item.records / peak) * 100)}%`, animationDelay: `${index * 45}ms` }} />
                  </div>
                  <span className="industrial-label">{item.hour.slice(0, 5)}</span>
                </div>
              ))}
            </div>
          ) : <div className="chart-empty">Nenhuma marcação registrada hoje.</div>}
        </article>

        <article className="data-board worksite-board">
          <header className="data-board-header">
            <div><span>DADOS / 02</span><h2>Atividade por obra</h2><p>Distribuição dos registros do período.</p></div>
          </header>
          <div className="site-ledger">
            {metrics.by_worksite.length ? metrics.by_worksite.map((site, index) => (
              <div className="site-ledger-row" key={site.name}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <div><strong>{site.name}</strong><small>{site.records} reg.</small></div>
                  <div className="site-ledger-track"><span style={{ width: `${Math.max(3, (site.records / worksitePeak) * 100)}%` }} /></div>
                </div>
              </div>
            )) : <div className="chart-empty">Nenhuma atividade registrada.</div>}
          </div>
        </article>
      </section>
    </div>
  );
}

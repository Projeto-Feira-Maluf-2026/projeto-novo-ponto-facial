import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Camera,
  Clock3,
  FileDown,
  HardDrive,
  Plus,
  RefreshCw,
  ScanFace,
  ShieldAlert,
  UserPlus,
  UserX,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { userCan, userHasRole } from '../auth/permissions';
import { useDashboardSearch } from '../components/GlassShell';
import { apiClient, type ReportExportPayload } from '../services/api';
import type { AttendanceRecordStatus, DashboardDay, DashboardMetrics, DashboardRecentRecord } from '../types/domain';
import { appDateInput, appDayBoundaryIso, formatInAppTimeZone, parseApiDate, shiftDateInput } from '../utils/dateTime';

const REFRESH_MS = 20_000;
const nf = new Intl.NumberFormat('pt-BR');

/* ------------------------------------------------------------------ helpers */

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.motionMode === 'reduced';
}

/** Counts from the previously shown value to the new one. */
function useCountUp(value: number, duration = 900) {
  const [display, setDisplay] = useState(0);
  const shown = useRef(0);

  useEffect(() => {
    const from = shown.current;
    if (prefersReducedMotion() || from === value) {
      shown.current = value;
      setDisplay(value);
      return undefined;
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (value - from) * eased;
      shown.current = next;
      setDisplay(next);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [duration, value]);

  return display;
}

function dayLabel(date: string, options: Intl.DateTimeFormatOptions) {
  // Noon UTC of a São Paulo calendar day stays on the same day when formatted there.
  return formatInAppTimeZone(new Date(`${date}T15:00:00Z`), options);
}

function delta(current: number, previous: number | undefined) {
  if (previous === undefined) return null;
  return current - previous;
}

const STATUS_COPY: Record<AttendanceRecordStatus, { label: string; tone: 'pos' | 'neg' | 'warn' }> = {
  ACCEPTED: { label: 'Aceito', tone: 'pos' },
  REJECTED: { label: 'Recusado', tone: 'neg' },
  MANUAL_REVIEW: { label: 'Em revisão', tone: 'warn' },
  OFFLINE_PENDING: { label: 'Pendente', tone: 'warn' },
};

const PUNCH_COPY: Record<string, string> = {
  ENTRY: 'Entrada',
  LUNCH_OUT: 'Saída p/ almoço',
  LUNCH_IN: 'Volta do almoço',
  EXIT: 'Saída',
};

/* ------------------------------------------------------------------- toasts */

type Toast = { id: number; tone: 'pos' | 'neg' | 'info'; text: string };

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((items) => [...items.slice(-2), { id, tone, text }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4800);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((items) => items.filter((item) => item.id !== id)), []);
  return { toasts, push, dismiss };
}

function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="lg-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="lg-toast lg-glass" data-tone={toast.tone}>
          <span className="lg-toast-dot" aria-hidden="true" />
          <p>{toast.text}</p>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Fechar aviso"><X size={15} /></button>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- data hook */

function useDashboardData(onNewRecords: (count: number) => void, onStale: () => void) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState(false);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const seenIds = useRef<Set<string> | null>(null);
  const failedOnce = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await apiClient.dashboard();
      const ids = new Set((next.recent ?? []).map((row) => row.id));
      if (seenIds.current) {
        const fresh = [...ids].filter((id) => !seenIds.current!.has(id));
        setFreshIds(new Set(fresh));
        if (fresh.length) onNewRecords(fresh.length);
      }
      seenIds.current = ids;
      failedOnce.current = false;
      setMetrics(next);
      setError(false);
    } catch {
      setError(true);
      if (!failedOnce.current) onStale();
      failedOnce.current = true;
    }
  }, [onNewRecords, onStale]);

  useEffect(() => {
    void load();
    // Polling pauses while the tab is hidden and catches up as soon as it returns,
    // so idle tabs stop querying the database every 20 seconds.
    let timer = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    const onVisible = () => {
      if (document.hidden) return;
      window.clearInterval(timer);
      void load();
      timer = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { metrics, error, freshIds, reload: load };
}

/* -------------------------------------------------------------------- page */

export function DashboardPage() {
  const { toasts, push, dismiss } = useToasts();
  const [panelOpen, setPanelOpen] = useState(false);
  const onNewRecords = useCallback((count: number) => {
    push('pos', count === 1 ? '1 novo ponto registrado' : `${count} novos pontos registrados`);
  }, [push]);
  const onStale = useCallback(() => push('neg', 'Sem resposta do servidor. Mostrando os últimos dados.'), [push]);
  const { metrics, error, freshIds, reload } = useDashboardData(onNewRecords, onStale);

  let body: React.ReactNode;
  if (error && !metrics) {
    body = (
      <section className="lg-card lg-glass lg-error" role="alert">
        <AlertTriangle size={28} aria-hidden="true" />
        <h2>Não conseguimos carregar os números</h2>
        <p>Pode ser a internet ou o servidor. Você continua conectado; tente de novo em instantes.</p>
        <button className="lg-btn-primary" type="button" onClick={() => void reload()}>
          <RefreshCw size={17} aria-hidden="true" /> Tentar novamente
        </button>
      </section>
    );
  } else if (!metrics) {
    body = <DashboardSkeleton />;
  } else {
    body = <DashboardGrid metrics={metrics} freshIds={freshIds} onNewRecord={() => setPanelOpen(true)} />;
  }

  return (
    <>
      <h1 className="sr-only">Visão geral</h1>
      {body}
      <NewRecordPanel open={panelOpen} onClose={() => setPanelOpen(false)} onToast={push} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function DashboardSkeleton() {
  const spans = ['lg-c5 lg-tall', 'lg-c7 lg-tall', 'lg-c8', 'lg-c4', 'lg-c8', 'lg-c4'];
  return (
    <div className="lg-grid" role="status" aria-label="Carregando indicadores">
      {spans.map((span, index) => (
        <div key={index} className={`lg-card lg-glass lg-skeleton ${span}`} aria-hidden="true">
          <span className="lg-sk-line is-short" />
          <span className="lg-sk-line is-big" />
          <span className="lg-sk-line" />
          <span className="lg-sk-block" />
        </div>
      ))}
    </div>
  );
}

function DashboardGrid({
  metrics,
  freshIds,
  onNewRecord,
}: {
  metrics: DashboardMetrics;
  freshIds: Set<string>;
  onNewRecord: () => void;
}) {
  const daily = metrics.daily ?? [];
  const yesterday = daily.length >= 2 ? daily[daily.length - 2] : undefined;
  let order = 0;
  const next = () => ({ '--i': order++ } as React.CSSProperties);

  return (
    <div className="lg-grid">
      <Hero metrics={metrics} daily={daily} yesterday={yesterday} onNewRecord={onNewRecord} style={next()} />
      <KpiGrid metrics={metrics} yesterday={yesterday} style={next()} />
      <EvolutionChart daily={daily} timeline={metrics.timeline} style={next()} />
      <SuccessRing status={metrics.status_today ?? {}} style={next()} />
      <RecordsTable records={metrics.recent ?? []} total={metrics.records_today} freshIds={freshIds} style={next()} />
      <WorksiteBars sites={metrics.by_worksite} style={next()} />
      <Heatmap daily={daily} style={next()} />
      <Streak daily={daily} style={next()} />
    </div>
  );
}

/* -------------------------------------------------------------------- hero */

function DeltaChip({ value, invert = false, suffix = '' }: { value: number | null; invert?: boolean; suffix?: string }) {
  if (value === null) return null;
  const up = value > 0;
  const tone = value === 0 ? 'flat' : (up !== invert ? 'pos' : 'neg');
  return (
    <span className="lg-chip" data-tone={tone}>
      <span aria-hidden="true">{value === 0 ? '■' : up ? '▲' : '▼'}</span>
      {value > 0 ? '+' : ''}{nf.format(value)}{suffix}
      <span className="sr-only"> em relação a ontem</span>
    </span>
  );
}

function Hero({
  metrics,
  daily,
  yesterday,
  onNewRecord,
  style,
}: {
  metrics: DashboardMetrics;
  daily: DashboardDay[];
  yesterday?: DashboardDay;
  onNewRecord: () => void;
  style: React.CSSProperties;
}) {
  const present = useCountUp(metrics.present_employees);
  const rate = metrics.total_employees > 0 ? Math.round((metrics.present_employees / metrics.total_employees) * 100) : 0;
  const week = daily.slice(-7);
  const weekPeak = Math.max(1, ...week.map((day) => day.present));

  return (
    <section className="lg-card lg-glass lg-hero lg-c5" style={style} aria-labelledby="lg-hero-title">
      <header className="lg-card-head">
        <div>
          <h2 id="lg-hero-title">Presença hoje</h2>
          <p>Funcionários com ponto aceito</p>
        </div>
        <DeltaChip value={delta(metrics.present_employees, yesterday?.present)} />
      </header>

      <p className="lg-hero-number" aria-label={`${metrics.present_employees} de ${metrics.total_employees} funcionários`}>
        <span>{nf.format(Math.round(present))}</span>
        <small>/{nf.format(metrics.total_employees)}</small>
      </p>

      {week.length > 0 && (
        <div className="lg-mini-bars" role="img" aria-label={`Presença nos últimos 7 dias: ${week.map((day) => `${dayLabel(day.date, { weekday: 'short' })} ${day.present}`).join(', ')}`}>
          {week.map((day, index) => (
            <span key={day.date} data-today={index === week.length - 1 || undefined}>
              <i style={{ height: `${Math.max(6, (day.present / weekPeak) * 100)}%` }} />
              <small>{dayLabel(day.date, { weekday: 'narrow' })}</small>
            </span>
          ))}
        </div>
      )}

      <div className="lg-goal">
        <div><span>Meta: equipe inteira</span><strong className="lg-num">{rate}%</strong></div>
        <div className="lg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate} aria-label="Presença da equipe ativa">
          <span style={{ width: `${rate}%` }} />
        </div>
      </div>

      <div className="lg-hero-actions">
        <Link to="/terminal-facial" className="lg-btn-primary lg-liquid">
          <ScanFace size={18} aria-hidden="true" /> Abrir ponto automático
        </Link>
        <button type="button" className="lg-btn-ghost lg-liquid" onClick={onNewRecord}>
          <Plus size={17} aria-hidden="true" /> Novo registro
        </button>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------- KPIs */

interface KpiProps {
  label: string;
  value: number;
  icon: LucideIcon;
  caption: string;
  digits?: number;
  unit?: string;
  change?: number | null;
  invert?: boolean;
  tone?: 'pos' | 'neg' | 'warn';
}

function Kpi({ label, value, icon: Icon, caption, digits = 0, unit, change = null, invert, tone }: KpiProps) {
  const shown = useCountUp(value);
  return (
    <article className="lg-kpi" data-tone={tone}>
      <div className="lg-kpi-top">
        <span className="lg-kpi-label">{label}</span>
        <span className="lg-kpi-icon" aria-hidden="true"><Icon size={17} /></span>
      </div>
      <strong className="lg-kpi-value lg-num">
        {shown.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}
        {unit && <small>{unit}</small>}
      </strong>
      <div className="lg-kpi-foot">
        <DeltaChip value={change} invert={invert} />
        <span>{caption}</span>
      </div>
    </article>
  );
}

function KpiGrid({ metrics, yesterday, style }: { metrics: DashboardMetrics; yesterday?: DashboardDay; style: React.CSSProperties }) {
  return (
    <section className="lg-card lg-glass lg-c7 lg-kpis" style={style} aria-label="Indicadores do dia">
      <Kpi label="Ainda não chegaram" value={metrics.absent_employees} icon={UserX} tone={metrics.absent_employees ? 'warn' : undefined}
        caption={metrics.absent_employees ? 'sem ponto aceito hoje' : 'toda a equipe registrou'} />
      <Kpi label="Pontos registrados" value={metrics.records_today} icon={ScanFace}
        change={delta(metrics.records_today, yesterday?.records)} caption="vs. ontem" />
      <Kpi label="Horas trabalhadas" value={metrics.worked_hours_today} icon={Clock3} digits={1} unit="h"
        caption="somadas até agora, parciais" />
      <Kpi label="Obras ativas" value={metrics.worksites} icon={Building2} caption="em andamento" />
      <Kpi label="Câmeras ligadas" value={metrics.connected_devices} icon={HardDrive} caption="com sinal hoje" />
      <Kpi label="Alertas para conferir" value={metrics.fraud_alerts} icon={ShieldAlert} tone={metrics.fraud_alerts ? 'neg' : undefined}
        change={delta(metrics.fraud_alerts, yesterday?.alerts)} invert caption="tentativas suspeitas" />
    </section>
  );
}

/* ---------------------------------------------------------- evolution chart */

type Period = 'today' | '7' | '14' | '30';

function smoothPath(points: Array<[number, number]>) {
  // Monotone cubic interpolation: smooth without overshooting below zero.
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : '';
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1][0] - points[i][0]);
    slope.push((points[i + 1][1] - points[i][1]) / dx[i]);
  }
  const tangent = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) {
    tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  }
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) { tangent[i] = 0; tangent[i + 1] = 0; continue; }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) { tangent[i] = (3 * a * slope[i]) / h; tangent[i + 1] = (3 * b * slope[i]) / h; }
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const step = dx[i] / 3;
    d += ` C${x0 + step},${y0 + tangent[i] * step} ${x1 - step},${y1 - tangent[i + 1] * step} ${x1},${y1}`;
  }
  return d;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function EvolutionChart({
  daily,
  timeline,
  style,
}: {
  daily: DashboardDay[];
  timeline: DashboardMetrics['timeline'];
  style: React.CSSProperties;
}) {
  const [period, setPeriod] = useState<Period>(daily.length ? '14' : 'today');
  const [active, setActive] = useState<number | null>(null);
  const { ref, width } = useWidth<HTMLDivElement>();
  const gradientId = `lg-area-${useId().replace(/:/g, '')}`;
  const height = 230;
  const pad = { top: 18, right: 12, bottom: 28, left: 12 };

  const series = useMemo(() => {
    if (period === 'today') {
      return timeline.map((item) => ({ key: item.hour, label: `${item.hour.slice(0, 5)}`, long: `às ${item.hour.slice(0, 5)}`, value: item.records, extra: null as number | null }));
    }
    return daily.slice(-Number(period)).map((day) => ({
      key: day.date,
      label: dayLabel(day.date, { day: '2-digit', month: '2-digit' }),
      long: dayLabel(day.date, { weekday: 'long', day: 'numeric', month: 'long' }),
      value: day.records,
      extra: day.present,
    }));
  }, [daily, period, timeline]);

  const total = series.reduce((sum, item) => sum + item.value, 0);
  const peak = Math.max(1, ...series.map((item) => item.value));
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const points: Array<[number, number]> = series.map((item, index) => [
    pad.left + (series.length === 1 ? plotW / 2 : (index / (series.length - 1)) * plotW),
    pad.top + plotH - (item.value / peak) * plotH,
  ]);
  const line = smoothPath(points);
  const area = points.length > 1
    ? `${line} L${points[points.length - 1][0]},${pad.top + plotH} L${points[0][0]},${pad.top + plotH} Z`
    : '';
  const labelEvery = Math.max(1, Math.ceil(series.length / Math.max(2, Math.floor(plotW / 64))));

  const pick = (clientX: number) => {
    const node = ref.current;
    if (!node || !series.length) return;
    const x = clientX - node.getBoundingClientRect().left - pad.left;
    const index = series.length === 1 ? 0 : Math.round((x / plotW) * (series.length - 1));
    setActive(Math.min(series.length - 1, Math.max(0, index)));
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (!series.length) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      setActive((current) => Math.min(series.length - 1, Math.max(0, (current ?? series.length - 1) + (current === null ? 0 : step))));
    }
    if (event.key === 'Escape') setActive(null);
  };

  const periods: Array<{ value: Period; label: string }> = [
    { value: 'today', label: 'Hoje' },
    ...(daily.length ? [{ value: '7' as Period, label: '7 dias' }, { value: '14' as Period, label: '14 dias' }, { value: '30' as Period, label: '30 dias' }] : []),
  ];
  const activeItem = active !== null ? series[active] : null;

  return (
    <section className="lg-card lg-glass lg-c8" style={style} aria-labelledby="lg-evo-title">
      <header className="lg-card-head">
        <div>
          <h2 id="lg-evo-title">Evolução dos pontos</h2>
          <p><span className="lg-num">{nf.format(total)}</span> pontos {period === 'today' ? 'hoje, por horário' : `nos últimos ${period} dias`}</p>
        </div>
        <div className="lg-seg" role="group" aria-label="Período do gráfico">
          {periods.map((item) => (
            <button key={item.value} type="button" aria-pressed={period === item.value} onClick={() => { setPeriod(item.value); setActive(null); }}>
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div
        ref={ref}
        className="lg-chart"
        tabIndex={series.length ? 0 : -1}
        role="img"
        aria-label={series.length ? `Gráfico de pontos. Maior valor: ${peak} pontos. Use as setas para ver cada ponto.` : 'Sem pontos no período'}
        onPointerMove={(event) => pick(event.clientX)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {!series.length || total === 0 ? (
          <div className="lg-empty">
            <ScanFace size={26} aria-hidden="true" />
            <p>Quando o primeiro ponto do período for batido, ele aparece aqui.</p>
          </div>
        ) : width > 0 && (
          <>
            <svg width={width} height={height} aria-hidden="true">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--pos)" stopOpacity="0.38" />
                  <stop offset="1" stopColor="var(--pos)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75, 1].map((step) => (
                <line key={step} x1={pad.left} x2={width - pad.right} y1={pad.top + plotH - step * plotH} y2={pad.top + plotH - step * plotH} className="lg-gridline" />
              ))}
              {area && <path d={area} fill={`url(#${gradientId})`} className="lg-area" />}
              <path d={line} className="lg-line" pathLength={1} />
              {series.map((item, index) => ((index % labelEvery === 0 && index <= series.length - 1 - labelEvery / 2) || index === series.length - 1) && (
                <text key={item.key} x={points[index][0]} y={height - 8} textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'} className="lg-axis">
                  {item.label}
                </text>
              ))}
              {active !== null && (
                <>
                  <line x1={points[active][0]} x2={points[active][0]} y1={pad.top} y2={pad.top + plotH} className="lg-cursor" />
                  <circle cx={points[active][0]} cy={points[active][1]} r={5.5} className="lg-dot" />
                </>
              )}
            </svg>
            {activeItem && active !== null && (
              <div
                className="lg-tip lg-glass"
                style={{ left: `${Math.min(Math.max(points[active][0], 80), width - 80)}px`, top: `${Math.max(points[active][1] - 14, 8)}px` }}
              >
                <strong className="lg-num">{nf.format(activeItem.value)} pontos</strong>
                {activeItem.extra !== null && <span className="lg-num">{nf.format(activeItem.extra)} presentes</span>}
                <small>{activeItem.long}</small>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ success ring */

function SuccessRing({ status, style }: { status: Partial<Record<AttendanceRecordStatus, number>>; style: React.CSSProperties }) {
  const accepted = status.ACCEPTED ?? 0;
  const rejected = status.REJECTED ?? 0;
  const pending = (status.MANUAL_REVIEW ?? 0) + (status.OFFLINE_PENDING ?? 0);
  const total = accepted + rejected + pending;
  const rate = total ? (accepted / total) * 100 : 0;
  const shown = useCountUp(rate);
  const radius = 62;
  const circumference = 2 * Math.PI * radius;

  return (
    <section className="lg-card lg-glass lg-c4 lg-ring-card" style={style} aria-labelledby="lg-ring-title">
      <header className="lg-card-head">
        <div>
          <h2 id="lg-ring-title">Taxa de reconhecimento</h2>
          <p>Leituras aceitas de primeira hoje</p>
        </div>
      </header>
      {total === 0 ? (
        <div className="lg-empty"><ScanFace size={26} aria-hidden="true" /><p>Nenhuma leitura hoje ainda.</p></div>
      ) : (
        <>
          <div className="lg-ring" role="img" aria-label={`${Math.round(rate)}% aceitos: ${accepted} aceitos, ${rejected} recusados, ${pending} pendentes`}>
            <svg viewBox="0 0 160 160" aria-hidden="true">
              <circle cx="80" cy="80" r={radius} className="lg-ring-track" />
              <circle
                cx="80" cy="80" r={radius}
                className="lg-ring-value"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - shown / 100)}
              />
            </svg>
            <div><strong className="lg-num">{Math.round(shown)}<small>%</small></strong><span>aceitos</span></div>
          </div>
          <dl className="lg-ring-legend">
            <div data-tone="pos"><dt>Aceitos</dt><dd className="lg-num">{nf.format(accepted)}</dd></div>
            <div data-tone="neg"><dt>Recusados</dt><dd className="lg-num">{nf.format(rejected)}</dd></div>
            <div data-tone="warn"><dt>Pendentes</dt><dd className="lg-num">{nf.format(pending)}</dd></div>
          </dl>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- table */

type Filter = 'all' | 'pos' | 'neg' | 'warn';

function RecordsTable({
  records,
  total,
  freshIds,
  style,
}: {
  records: DashboardRecentRecord[];
  total: number;
  freshIds: Set<string>;
  style: React.CSSProperties;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const { query, setQuery } = useDashboardSearch();
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: records.length, pos: 0, neg: 0, warn: 0 };
    for (const row of records) result[STATUS_COPY[row.status]?.tone ?? 'warn'] += 1;
    return result;
  }, [records]);
  const rows = records.filter((row) => {
    if (filter !== 'all' && (STATUS_COPY[row.status]?.tone ?? 'warn') !== filter) return false;
    if (!needle) return true;
    return `${row.employee_name} ${row.worksite_name}`.toLocaleLowerCase('pt-BR').includes(needle);
  });
  const filters: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: 'Todos' },
    { value: 'pos', label: 'Aceitos' },
    { value: 'neg', label: 'Recusados' },
    { value: 'warn', label: 'Pendentes' },
  ];

  return (
    <section className="lg-card lg-glass lg-c8 lg-table-card" style={style} aria-labelledby="lg-table-title">
      <header className="lg-card-head">
        <div>
          <h2 id="lg-table-title">Últimos pontos</h2>
          <p>{records.length < total ? `Os ${records.length} mais recentes de ${nf.format(total)} hoje` : 'Todos os pontos de hoje'}</p>
        </div>
        <Link to="/relatorios" className="lg-link">Relatórios <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </header>
      <div className="lg-table-tools">
        <div className="lg-pills" role="group" aria-label="Filtrar por situação">
          {filters.map((item) => (
            <button key={item.value} type="button" data-tone={item.value} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>
              {item.label} <span className="lg-num">{counts[item.value]}</span>
            </button>
          ))}
        </div>
        <label className="lg-search lg-search-inline">
          <span className="sr-only">Buscar nos pontos de hoje</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" autoComplete="off" />
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="lg-empty">
          <ScanFace size={26} aria-hidden="true" />
          <p>{records.length ? 'Nenhum ponto com esse filtro.' : 'Nenhum ponto registrado hoje ainda.'}</p>
        </div>
      ) : (
        <div className="lg-table-wrap">
          <table className="lg-table">
            <thead>
              <tr><th scope="col">Funcionário</th><th scope="col">Obra</th><th scope="col">Tipo</th><th scope="col">Situação</th><th scope="col" className="is-num">Horário</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = STATUS_COPY[row.status] ?? { label: row.status, tone: 'warn' as const };
                return (
                  <tr key={row.id} data-fresh={freshIds.has(row.id) || undefined}>
                    <th scope="row">{row.employee_name}</th>
                    <td>{row.worksite_name || '—'}</td>
                    <td>{PUNCH_COPY[row.punch_type] ?? row.punch_type}</td>
                    <td><span className="lg-status" data-tone={status.tone}>{status.label}</span></td>
                    <td className="is-num lg-num">{formatInAppTimeZone(parseApiDate(row.occurred_at), { hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------- worksite bars */

function WorksiteBars({ sites, style }: { sites: DashboardMetrics['by_worksite']; style: React.CSSProperties }) {
  const sorted = [...sites].sort((a, b) => b.records - a.records);
  const peak = Math.max(1, ...sorted.map((site) => site.records));
  return (
    <section className="lg-card lg-glass lg-c4" style={style} aria-labelledby="lg-bars-title">
      <header className="lg-card-head">
        <div><h2 id="lg-bars-title">Pontos por obra</h2><p>Movimento de hoje em cada obra</p></div>
        <Link to="/obras" className="lg-icon-link" aria-label="Ver obras"><ArrowUpRight size={17} /></Link>
      </header>
      {sorted.length === 0 ? (
        <div className="lg-empty"><Building2 size={26} aria-hidden="true" /><p>Nenhuma obra ativa.</p></div>
      ) : (
        <ol className="lg-hbars">
          {sorted.map((site) => (
            <li key={site.name} data-zero={site.records === 0 || undefined}>
              <div><span>{site.name}</span><strong className="lg-num">{nf.format(site.records)}</strong></div>
              <span className="lg-hbar" aria-hidden="true"><i style={{ width: `${site.records ? Math.max(3, (site.records / peak) * 100) : 0}%` }} /></span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ heatmap */

function Heatmap({ daily, style }: { daily: DashboardDay[]; style: React.CSSProperties }) {
  const [active, setActive] = useState<DashboardDay | null>(null);
  const peak = Math.max(1, ...daily.map((day) => day.records));
  // Calendar grid: columns are weekdays, the first row starts on the first day's weekday.
  const leading = daily.length ? new Date(`${daily[0].date}T15:00:00Z`).getUTCDay() : 0;
  const level = (records: number) => (records === 0 ? 0 : Math.min(4, Math.ceil((records / peak) * 4)));
  const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  return (
    <section className="lg-card lg-glass lg-c7" style={style} aria-labelledby="lg-heat-title">
      <header className="lg-card-head">
        <div><h2 id="lg-heat-title">Calendário de movimento</h2><p>Pontos por dia nos últimos 30 dias</p></div>
        <div className="lg-heat-legend" aria-hidden="true">
          <span>menos</span>{[0, 1, 2, 3, 4].map((step) => <i key={step} data-level={step} />)}<span>mais</span>
        </div>
      </header>
      {daily.length === 0 ? (
        <div className="lg-empty"><p>O histórico aparece depois da atualização do servidor.</p></div>
      ) : (
        <div className="lg-heat-wrap">
          <div className="lg-heat" role="grid" aria-label="Pontos por dia">
            {weekdays.map((day, index) => <span key={`h${index}`} className="lg-heat-head" aria-hidden="true">{day}</span>)}
            {Array.from({ length: leading }, (_, index) => <span key={`pad${index}`} aria-hidden="true" />)}
            {daily.map((day) => {
              const label = `${dayLabel(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${day.records} pontos, ${day.present} presentes${day.alerts ? `, ${day.alerts} alertas` : ''}`;
              return (
                <button
                  key={day.date}
                  type="button"
                  className="lg-heat-cell"
                  data-level={level(day.records)}
                  data-active={active?.date === day.date || undefined}
                  aria-label={label}
                  onPointerEnter={() => setActive(day)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(day)}
                  onBlur={() => setActive(null)}
                >
                  <span aria-hidden="true">{Number(day.date.slice(8))}</span>
                </button>
              );
            })}
          </div>
          <p className="lg-heat-detail" aria-live="polite">
            {active ? (
              <>
                <strong>{dayLabel(active.date, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
                <span className="lg-num">{nf.format(active.records)} pontos · {nf.format(active.present)} presentes{active.alerts ? ` · ${active.alerts} alertas` : ''}</span>
              </>
            ) : <span>Passe o mouse ou use Tab para ver cada dia.</span>}
          </p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- streak */

function Streak({ daily, style }: { daily: DashboardDay[]; style: React.CSSProperties }) {
  let current = 0;
  for (let index = daily.length - 1; index >= 0 && daily[index].alerts === 0; index -= 1) current += 1;
  let best = 0;
  let run = 0;
  for (const day of daily) {
    run = day.alerts === 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const shownCurrent = useCountUp(current);
  const lastDays = daily.slice(-14);

  return (
    <section className="lg-card lg-glass lg-c5" style={style} aria-labelledby="lg-streak-title">
      <header className="lg-card-head">
        <div><h2 id="lg-streak-title">Dias sem alerta</h2><p>Sem tentativa suspeita no ponto</p></div>
      </header>
      {daily.length === 0 ? (
        <div className="lg-empty"><p>O histórico aparece depois da atualização do servidor.</p></div>
      ) : (
        <>
          <div className="lg-streak">
            <div><span>Sequência atual</span><strong className="lg-num">{Math.round(shownCurrent)}<small> {current === 1 ? 'dia' : 'dias'}</small></strong></div>
            <div><span>Melhor em 30 dias</span><strong className="lg-num">{best}<small> {best === 1 ? 'dia' : 'dias'}</small></strong></div>
          </div>
          <ol className="lg-dots" aria-label="Últimos 14 dias">
            {lastDays.map((day) => {
              const tone = day.alerts > 0 ? 'neg' : day.records > 0 ? 'pos' : 'idle';
              const text = day.alerts > 0 ? `${day.alerts} alerta${day.alerts > 1 ? 's' : ''}` : day.records > 0 ? 'sem alertas' : 'sem movimento';
              return (
                <li key={day.date} data-tone={tone} title={`${dayLabel(day.date, { day: '2-digit', month: '2-digit' })}: ${text}`}>
                  <span className="sr-only">{dayLabel(day.date, { day: 'numeric', month: 'long' })}: {text}</span>
                </li>
              );
            })}
          </ol>
          <p className="lg-caption"><i data-tone="pos" /> sem alertas <i data-tone="neg" /> com alertas <i data-tone="idle" /> sem movimento</p>
        </>
      )}
    </section>
  );
}

/* --------------------------------------------------------- new record panel */

type ExportRange = 'today' | 'week' | 'month';

function NewRecordPanel({ open, onClose, onToast }: { open: boolean; onClose: () => void; onToast: (tone: Toast['tone'], text: string) => void }) {
  const { user } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [range, setRange] = useState<ExportRange>('today');
  const [format, setFormat] = useState<ReportExportPayload['format']>('pdf');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const canExport = userCan(user, 'reports:export');
  const privileged = userHasRole(user, ['SUPER_ADMIN', 'RH', 'GESTOR_OBRA', 'SUPERVISOR']);

  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement as HTMLElement | null;
    setError(null);
    const panel = panelRef.current;
    window.requestAnimationFrame(() => panel?.querySelector<HTMLElement>('a, button, input, select')?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener.current?.focus();
    };
  }, [open, onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const end = appDateInput(new Date());
    const start = range === 'today' ? end : range === 'week' ? shiftDateInput(end, -6) : `${end.slice(0, 8)}01`;
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.exportReport({
        kind: range === 'today' ? 'daily' : range === 'week' ? 'weekly' : 'monthly',
        format,
        starts_at: appDayBoundaryIso(start),
        ends_at: appDayBoundaryIso(end, true),
        employee_id: null,
        worksite_id: null,
      });
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast('pos', `Relatório ${result.filename} baixado`);
      onClose();
    } catch (exportError) {
      const message = exportError instanceof Error && exportError.message && !/^Request failed|Network Error/i.test(exportError.message)
        ? exportError.message
        : 'Não foi possível gerar o relatório. Tente de novo.';
      setError(message);
      setShake((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const actions: Array<{ to: string; label: string; hint: string; icon: LucideIcon; show: boolean }> = [
    { to: '/terminal-facial', label: 'Bater ponto', hint: 'Abrir a câmera do ponto automático', icon: Camera, show: true },
    { to: '/funcionarios', label: 'Novo funcionário', hint: 'Cadastrar e registrar o rosto', icon: UserPlus, show: privileged },
    { to: '/obras', label: 'Nova obra', hint: 'Cadastrar um local de trabalho', icon: Building2, show: privileged },
  ];

  return (
    <div className="lg-sheet-layer">
      <button type="button" className="lg-scrim" aria-label="Fechar painel" tabIndex={-1} onClick={onClose} />
      <div ref={panelRef} className="lg-sheet lg-glass" role="dialog" aria-modal="true" aria-labelledby="lg-sheet-title">
        <header className="lg-card-head">
          <div><h2 id="lg-sheet-title">Novo registro</h2><p>O que você quer fazer agora?</p></div>
          <button type="button" className="lg-icon-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>
        <nav className="lg-sheet-actions" aria-label="Atalhos">
          {actions.filter((item) => item.show).map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} className="lg-sheet-action" onClick={onClose}>
                <span className="lg-kpi-icon" aria-hidden="true"><Icon size={18} /></span>
                <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            );
          })}
        </nav>
        {canExport && (
          <form key={shake} className="lg-sheet-form" data-shake={shake > 0 || undefined} onSubmit={(event) => void submit(event)}>
            <h3><FileDown size={17} aria-hidden="true" /> Exportar relatório de ponto</h3>
            <fieldset>
              <legend>Período</legend>
              <div className="lg-seg">
                {([['today', 'Hoje'], ['week', '7 dias'], ['month', 'Este mês']] as Array<[ExportRange, string]>).map(([value, label]) => (
                  <label key={value}><input type="radio" name="lg-range" value={value} checked={range === value} onChange={() => setRange(value)} /><span>{label}</span></label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Formato</legend>
              <div className="lg-seg">
                {(['pdf', 'xlsx', 'csv'] as const).map((value) => (
                  <label key={value}><input type="radio" name="lg-format" value={value} checked={format === value} onChange={() => setFormat(value)} /><span>{value.toUpperCase()}</span></label>
                ))}
              </div>
            </fieldset>
            {error && <p className="lg-form-error" role="alert">{error}</p>}
            <button type="submit" className="lg-btn-primary lg-liquid" disabled={busy}>
              {busy ? <RefreshCw size={17} className="lg-spin" aria-hidden="true" /> : <FileDown size={17} aria-hidden="true" />}
              {busy ? 'Gerando…' : 'Baixar relatório'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: 'green' | 'red' | 'blue' | 'gray' | 'amber';
  hint?: string;
}

export function MetricCard({ label, value, icon: Icon, tone, hint }: MetricCardProps) {
  return (
    <section className="metric-card app-view-transition" data-tone={tone}>
      <div className="metric-card-heading">
        <p className="metric-label">{label}</p>
        <div className="metric-icon" aria-hidden="true">
          <Icon size={19} strokeWidth={1.9} />
        </div>
      </div>
      <strong className="metric-value">{value}</strong>
      {hint && (
        <p className="metric-hint">
          <span aria-hidden="true" />
          {hint}
        </p>
      )}
    </section>
  );
}

import type { LucideIcon } from 'lucide-react';
import { useRef } from 'react';

import { useMetricMotion } from '../animations/useMotion';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: 'green' | 'red' | 'blue' | 'gray' | 'amber';
  hint?: string;
}

export function MetricCard({ label, value, icon: Icon, tone, hint }: MetricCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const valueRef = useRef<HTMLElement>(null);
  useMetricMotion(cardRef, valueRef, value);

  return (
    <section ref={cardRef} className="metric-card app-view-transition" data-tone={tone}>
      <div className="metric-card-heading">
        <p className="metric-label">{label}</p>
        <div className="metric-icon" aria-hidden="true">
          <Icon size={19} strokeWidth={1.9} />
        </div>
      </div>
      <strong ref={valueRef} className="metric-value">{value}</strong>
      {hint && (
        <p className="metric-hint">
          <span aria-hidden="true" />
          {hint}
        </p>
      )}
    </section>
  );
}

import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: 'green' | 'red' | 'blue' | 'gray';
}

const tones = {
  green: { accent: '#18745b', foreground: '#126148' },
  red: { accent: '#b42318', foreground: '#b42318' },
  blue: { accent: '#3f596d', foreground: '#334a5c' },
  gray: { accent: '#64748b', foreground: '#334155' },
};

export function MetricCard({ label, value, icon: Icon, tone }: MetricCardProps) {
  const style = {
    '--metric-accent': tones[tone].accent,
    '--metric-foreground': tones[tone].foreground,
  } as CSSProperties;

  return (
    <section className="metric-card app-view-transition" style={style}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-steel dark:text-slate-400">{label}</p>
          <strong className="mt-2 block text-3xl font-semibold tracking-tight">{value}</strong>
        </div>
        <div className="metric-icon">
          <Icon size={21} />
        </div>
      </div>
    </section>
  );
}

import { useId } from 'react';

interface BrandMarkProps {
  className?: string;
  title?: string;
}

/**
 * Marca do projeto: o "C" de Curitiba Empreiteira aberto para a direita, com o
 * ponto lima no lugar onde a leitura do rosto confirma a presença.
 */
export function BrandMark({ className = 'brand-mark', title }: BrandMarkProps) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#23272a" />
          <stop offset="1" stopColor="#0d0f10" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="2" x2="0" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id}-tile)`} />
      <rect x="2.5" y="2.5" width="59" height="59" rx="15.5" fill="none" stroke={`url(#${id}-rim)`} />
      <path
        d="M40.40 22.63A14 14 0 1 0 40.40 41.37"
        fill="none"
        stroke="#f4f5f2"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <circle cx="43.5" cy="32" r="4.2" fill="#d4f36b" />
    </svg>
  );
}

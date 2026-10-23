import { useId } from 'react';

interface BrandMarkProps {
  className?: string;
  title?: string;
}

/**
 * Marca do projeto: cantos de enquadramento da câmera (o reconhecimento) em volta
 * de três blocos que sobem como uma obra, com a presença acesa no mais alto.
 */
export function BrandMark({ className = 'brand-mark', title }: BrandMarkProps) {
  const gradientId = `brand-mark-${useId().replace(/:/g, '')}`;
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
        <linearGradient id={gradientId} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2c5a37" />
          <stop offset="1" stopColor="#13271f" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${gradientId})`} />
      <path
        d="M13 22v-5a4 4 0 0 1 4-4h5M42 13h5a4 4 0 0 1 4 4v5M51 42v5a4 4 0 0 1-4 4h-5M22 51h-5a4 4 0 0 1-4-4v-5"
        fill="none"
        stroke="#c9e69c"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <rect x="20" y="31" width="7" height="14" rx="1.6" fill="#ffffff" opacity="0.7" />
      <rect x="28.5" y="27" width="7" height="18" rx="1.6" fill="#ffffff" />
      <rect x="37" y="34" width="7" height="11" rx="1.6" fill="#ffffff" opacity="0.7" />
      <circle cx="32" cy="20.5" r="3.4" fill="#c9e69c" />
    </svg>
  );
}

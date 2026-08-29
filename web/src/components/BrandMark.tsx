interface BrandMarkProps {
  className?: string;
  title?: string;
}

export function BrandMark({ className = 'brand-mark', title }: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      <rect x="4" y="4" width="56" height="56" rx="14" fill="currentColor" />
      <path
        d="M32 14 46 22v20l-14 8-14-8V22l14-8Z"
        fill="none"
        stroke="var(--brand-mark-line, #a3b18a)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="32" r="8" fill="none" stroke="#fff" strokeWidth="3" />
      <circle cx="32" cy="32" r="3" fill="var(--brand-mark-line, #a3b18a)" />
    </svg>
  );
}

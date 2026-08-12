import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: 'var(--color-text)',
        steel: 'var(--color-muted)',
        limeSafe: 'var(--color-success)',
        signal: 'var(--color-muted)',
        signalAccent: 'var(--color-accent)',
        concrete: 'var(--color-canvas)',
        graphite: 'var(--color-nav)',
        asphalt: 'var(--color-nav-soft)',
        caution: 'var(--color-warning)',
        clay: 'var(--color-line)',
        warmGray: 'var(--color-subtle)',
      },
      boxShadow: {
        panel: 'var(--shadow-sm)',
      },
    },
  },
  plugins: [],
} satisfies Config;

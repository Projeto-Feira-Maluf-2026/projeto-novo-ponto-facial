import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: '#0F172A',
        steel: '#64748B',
        limeSafe: '#18745B',
        signal: '#475569',
        signalAccent: '#18745B',
        concrete: '#F4F6F8',
        graphite: '#0B0F14',
        asphalt: '#17202D',
        caution: '#B7791F',
        clay: '#E2E8F0',
        warmGray: '#94A3B8',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 20px rgba(15, 23, 42, 0.05)',
      },
    },
  },
  plugins: [],
} satisfies Config;

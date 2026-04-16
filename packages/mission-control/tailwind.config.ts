import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ─── LEGACY TERMINAL PALETTE ─────────────────────────────────────────
        // Kept in place during the SpaceX migration so every existing component
        // continues to render unchanged. New work should use the `mc-*` tokens
        // below. The terminal-* tokens are removed entirely in Phase 6.
        terminal: {
          bg: '#0a0a0f',
          surface: '#111118',
          border: '#1e1e2e',
          muted: '#2a2a3a',
          text: '#cdd6f4',
          dim: '#6c7086',
          green: '#a6e3a1',
          red: '#f38ba8',
          yellow: '#f9e2af',
          blue: '#89b4fa',
          purple: '#cba6f7',
          cyan: '#89dceb',
          orange: '#fab387',
        },
        // ─── SPACEX CREW DRAGON PALETTE (Phase 1+) ───────────────────────────
        // Pure black canvas, 1px cyan hairline borders, outlined (not filled)
        // panels, iOS-style semantic colors. See DESIGN-SYSTEM.md for usage.
        mc: {
          bg: '#000000',
          surface: 'rgba(255,255,255,0.02)',
          'surface-hover': 'rgba(255,255,255,0.04)',
          border: 'rgba(90,200,250,0.12)',
          'border-hover': 'rgba(90,200,250,0.22)',
          'border-active': 'rgba(90,200,250,0.40)',
          accent: '#5AC8FA',
          'accent-dim': 'rgba(90,200,250,0.15)',
          text: 'rgba(255,255,255,0.87)',
          'text-secondary': 'rgba(255,255,255,0.50)',
          'text-tertiary': 'rgba(255,255,255,0.30)',
          'text-label': 'rgba(255,255,255,0.35)',
          success: '#30D158',
          danger: '#FF453A',
          warning: '#FFD60A',
          info: '#64D2FF',
          blocked: '#FF9F0A',
          // Department accents — every dept-color reference in the app
          // migrates to one of these six tokens during Phase 2+.
          'dept-executive': '#FFD60A',
          'dept-development': '#5AC8FA',
          'dept-marketing': '#FF9F0A',
          'dept-operations': '#30D158',
          'dept-finance': '#BF5AF2',
          'dept-support': '#64D2FF',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      fontWeight: {
        // Inter ultralight stack — labels and headings use 200–400.
        extralight: '200',
      },
      letterSpacing: {
        label: '0.12em',
      },
      borderRadius: {
        panel: '8px',
        chip: '6px',
        badge: '3px',
      },
      transitionTimingFunction: {
        'mc-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        mc: '220ms',
      },
      keyframes: {
        'mc-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        'mc-breathe': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(90,200,250,0.0)' },
          '50%': { boxShadow: '0 0 12px 2px rgba(90,200,250,0.25)' },
        },
        'mc-particle-flow': {
          '0%': { offsetDistance: '0%', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '100%': { offsetDistance: '100%', opacity: '0' },
        },
      },
      animation: {
        'mc-pulse': 'mc-pulse 2.4s ease-in-out infinite',
        'mc-breathe': 'mc-breathe 3.2s ease-in-out infinite',
        'mc-particle-flow': 'mc-particle-flow 1.8s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;

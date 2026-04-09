import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
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
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;

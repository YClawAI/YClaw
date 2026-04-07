# YCLAW — Design System

> Code-ready design tokens, CSS custom properties, Tailwind configuration, and animation specifications.

---

## 1. CSS Custom Properties

Paste this into `globals.css`:

```css
:root {
  /* ======================== */
  /* COLORS — Ember Gallery   */
  /* ======================== */

  /* Backgrounds */
  --yclaw-obsidian: #080604;
  --yclaw-ember-dark: #141008;
  --yclaw-warm-ash: #2A1E14;

  /* Accents */
  --yclaw-blaze: #FF6B2C;
  --yclaw-molten: #FFB800;
  --yclaw-pulse: #FF3366;

  /* Text */
  --yclaw-warm-gray: #887766;
  --yclaw-deep-warm: #554433;
  --yclaw-ghost: #332822;
  --yclaw-bone: #F5F0EB;

  /* Semantic */
  --yclaw-bg-primary: var(--yclaw-obsidian);
  --yclaw-bg-card: var(--yclaw-ember-dark);
  --yclaw-bg-elevated: #0c0806;
  --yclaw-border: #1a1410;
  --yclaw-border-hover: rgba(255, 107, 44, 0.13);
  --yclaw-text-primary: #ffffff;
  --yclaw-text-body: var(--yclaw-warm-gray);
  --yclaw-text-secondary: var(--yclaw-deep-warm);
  --yclaw-text-muted: var(--yclaw-ghost);
  --yclaw-text-disabled: #221a14;
  --yclaw-accent-primary: var(--yclaw-blaze);
  --yclaw-accent-secondary: var(--yclaw-molten);
  --yclaw-accent-tertiary: var(--yclaw-pulse);

  /* Positive / Negative */
  --yclaw-positive: var(--yclaw-molten);
  --yclaw-negative: var(--yclaw-pulse);

  /* ======================== */
  /* GRADIENTS                */
  /* ======================== */
  --yclaw-gradient-heat: linear-gradient(135deg, #FF6B2C, #FFB800, #FF3366);
  --yclaw-gradient-blaze-molten: linear-gradient(135deg, #FF6B2C, #FFB800);
  --yclaw-gradient-warm-bg: linear-gradient(180deg, #080604 0%, #0c0806 100%);
  --yclaw-gradient-card-glow: radial-gradient(circle, rgba(255,107,44,0.06) 0%, transparent 70%);

  /* ======================== */
  /* TYPOGRAPHY               */
  /* ======================== */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* Font weights */
  --font-thin: 100;
  --font-extralight: 200;
  --font-light: 300;
  --font-regular: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* ======================== */
  /* SPACING                  */
  /* ======================== */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 40px;
  --space-2xl: 60px;
  --space-3xl: 100px;
  --space-4xl: 120px;

  /* ======================== */
  /* RADII                    */
  /* ======================== */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  /* ======================== */
  /* SHADOWS                  */
  /* ======================== */
  --shadow-glow-sm: 0 0 8px rgba(255, 107, 44, 0.15);
  --shadow-glow-md: 0 0 30px rgba(255, 107, 44, 0.12);
  --shadow-glow-lg: 0 0 60px rgba(255, 107, 44, 0.08);
  --shadow-card-hover: 0 8px 30px rgba(255, 107, 44, 0.12);
  --shadow-button-hover: 0 8px 30px rgba(255, 107, 44, 0.25);

  /* ======================== */
  /* ANIMATION                */
  /* ======================== */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --duration-slow: 400ms;
  --duration-gradient: 8s;
  --duration-glow: 6s;
  --duration-breathe: 4s;

  /* ======================== */
  /* Z-INDEX                  */
  /* ======================== */
  --z-base: 0;
  --z-card: 1;
  --z-nav: 50;
  --z-modal: 100;
  --z-toast: 150;
  --z-grain: 9999;
}
```

---

## 2. Tailwind Configuration

```js
// tailwind.config.js
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        yclaw: {
          obsidian: '#080604',
          'ember-dark': '#141008',
          'warm-ash': '#2A1E14',
          blaze: '#FF6B2C',
          molten: '#FFB800',
          pulse: '#FF3366',
          'warm-gray': '#887766',
          'deep-warm': '#554433',
          ghost: '#332822',
          bone: '#F5F0EB',
          border: '#1a1410',
          elevated: '#0c0806',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'Fira Code', 'monospace'],
      },
      fontWeight: {
        thin: '100',
        extralight: '200',
        light: '300',
      },
      letterSpacing: {
        'wordmark': '0.75em',
        'label': '0.15em',
        'wide': '0.05em',
      },
      borderRadius: {
        'yclaw-sm': '6px',
        'yclaw-md': '10px',
        'yclaw-lg': '14px',
        'yclaw-xl': '20px',
      },
      boxShadow: {
        'glow-sm': '0 0 8px rgba(255, 107, 44, 0.15)',
        'glow-md': '0 0 30px rgba(255, 107, 44, 0.12)',
        'glow-lg': '0 0 60px rgba(255, 107, 44, 0.08)',
        'card-hover': '0 8px 30px rgba(255, 107, 44, 0.12)',
        'button-hover': '0 8px 30px rgba(255, 107, 44, 0.25)',
      },
      animation: {
        'gradient-shift': 'gradient-shift 8s ease infinite',
        'glow-breathe': 'glow-breathe 6s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 4s ease-in-out infinite',
        'heat-wave': 'heat-wave 8s ease-in-out infinite',
        'float-up': 'float-up 1s ease-out both',
        'flicker': 'flicker 5s ease-in-out infinite',
      },
      keyframes: {
        'gradient-shift': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'glow-breathe': {
          '0%, 100%': { opacity: '0.12', transform: 'scale(1)' },
          '50%': { opacity: '0.25', transform: 'scale(1.06)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.3', transform: 'scale(1)' },
          '50%': { opacity: '0.7', transform: 'scale(1.08)' },
        },
        'heat-wave': {
          '0%': { filter: 'blur(60px) brightness(1)' },
          '50%': { filter: 'blur(80px) brightness(1.3)' },
          '100%': { filter: 'blur(60px) brightness(1)' },
        },
        'float-up': {
          '0%': { transform: 'translateY(40px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'flicker': {
          '0%, 97%, 100%': { opacity: '1' },
          '98%': { opacity: '0.6' },
          '99%': { opacity: '0.85' },
        },
      },
    },
  },
  plugins: [],
};
```

---

## 3. Grain Overlay

Every page gets a fixed grain texture overlay. Apply to the root layout:

```css
body::after {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: var(--z-grain);
  opacity: 0.4;
}
```

---

## 4. Typography Scale

| Role | Font | Weight | Size | Line Height | Color | Extra |
|---|---|---|---|---|---|---|
| Wordmark | Inter | 100 | clamp(60px, 10vw, 120px) | 1 | Gradient fill | letter-spacing: 12-24px, uppercase |
| Page Title | Inter | 200 | 44-52px | 1.3 | `--yclaw-text-primary` | |
| Section Title | Inter | 200 | 28-32px | 1.4 | `--yclaw-text-primary` | |
| Section Label | JetBrains Mono | 400 | 10px | 1 | `--yclaw-blaze` at 50% opacity | letter-spacing: 4px, uppercase |
| Subhead | Inter | 300 | 18-22px | 1.5 | `--yclaw-warm-gray` | |
| Body | Inter | 300 | 16px | 1.8 | `--yclaw-warm-gray` | max-width: 700px |
| Body Small | Inter | 300 | 13-14px | 1.6 | `--yclaw-deep-warm` | |
| Data Large | JetBrains Mono | 600 | 24-28px | 1 | Gradient fill | |
| Data Medium | JetBrains Mono | 500 | 16-20px | 1 | `--yclaw-text-primary` or gradient | |
| Data Small | JetBrains Mono | 400 | 12px | 1 | `--yclaw-warm-gray` | |
| UI Label | JetBrains Mono | 400 | 9-10px | 1 | `--yclaw-ghost` | letter-spacing: 2-3px, uppercase |
| Nav Link | Inter | 300 | 12-13px | 1 | `--yclaw-deep-warm` | hover: `--yclaw-blaze` |
| Button Primary | Inter | 500 | 13-14px | 1 | `--yclaw-obsidian` | on gradient bg |
| Button Ghost | Inter | 300 | 13-14px | 1 | `--yclaw-warm-gray` | border: `--yclaw-warm-ash` |

### Gradient Text Utility

```css
.text-gradient-heat {
  background: var(--yclaw-gradient-heat);
  background-size: 300% 300%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: gradient-shift var(--duration-gradient) ease infinite;
}

.text-gradient-blaze {
  background: var(--yclaw-gradient-blaze-molten);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

---

## 5. Component Tokens

### Cards
```css
.card {
  background: var(--yclaw-bg-card);
  border: 1px solid var(--yclaw-border);
  border-radius: var(--radius-lg);
  transition: border-color var(--duration-slow) var(--ease-default),
              box-shadow var(--duration-slow) var(--ease-default);
}
.card:hover {
  border-color: var(--yclaw-border-hover);
  box-shadow: var(--shadow-glow-lg);
}
```

### Buttons
```css
.btn-warm {
  background: var(--yclaw-gradient-blaze-molten);
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--yclaw-obsidian);
  padding: 13px 32px;
  cursor: pointer;
  transition: box-shadow var(--duration-normal) var(--ease-default),
              transform var(--duration-normal) var(--ease-default);
}
.btn-warm:hover {
  box-shadow: var(--shadow-button-hover);
  transform: translateY(-1px);
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--yclaw-warm-ash);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 300;
  color: var(--yclaw-warm-gray);
  padding: 13px 32px;
  cursor: pointer;
  transition: border-color var(--duration-normal) var(--ease-default),
              color var(--duration-normal) var(--ease-default);
}
.btn-ghost:hover {
  border-color: rgba(255, 107, 44, 0.2);
  color: var(--yclaw-blaze);
}
```

### Stat Pills
```css
.stat-pill {
  background: var(--yclaw-ember-dark);
  border: 1px solid var(--yclaw-border);
  border-radius: var(--radius-md);
  padding: 14px;
  text-align: center;
}
.stat-pill .value {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 16px;
}
.stat-pill .label {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--yclaw-ghost);
  margin-top: 4px;
}
```

### Nav
```css
.nav {
  padding: 18px 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--yclaw-border);
  backdrop-filter: blur(12px);
  background: rgba(8, 6, 4, 0.8);
  position: sticky;
  top: 0;
  z-index: var(--z-nav);
}
```

---

## 6. Icon Guidelines

- **Stroke width:** 1-1.5px
- **Style:** Monoline, rounded caps and joins
- **Default color:** `--yclaw-warm-gray`
- **Active color:** Gradient stroke (blaze → molten)
- **Size:** 16px (inline), 20px (nav), 36px (feature cards)
- **Library recommendation:** Lucide React (thin variant) or custom SVG
- Icons should feel like they were drawn with a single heated wire

---

## 7. The Burning Eye — SVG Code

### Full Mark (Primary Logo)
```html
<svg width="280" height="280" viewBox="0 0 280 280">
  <defs>
    <linearGradient id="eye-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff6b2c"/>
      <stop offset="50%" stop-color="#ffb800"/>
      <stop offset="100%" stop-color="#ff3366"/>
    </linearGradient>
    <radialGradient id="iris-glow" cx="50%" cy="50%">
      <stop offset="0%" stop-color="#ffb800" stop-opacity="0.5"/>
      <stop offset="50%" stop-color="#ff6b2c" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#ff6b2c" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="core-glow" cx="50%" cy="50%">
      <stop offset="0%" stop-color="#ffb800" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#ff6b2c" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft-glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <!-- Ambient glow -->
  <circle cx="140" cy="140" r="80" fill="url(#iris-glow)"/>
  <!-- Outer eye strokes -->
  <path d="M40 140 Q140 60 240 140" fill="none" stroke="url(#eye-grad)" stroke-width="2" stroke-linecap="round" filter="url(#soft-glow)"/>
  <path d="M40 140 Q140 220 240 140" fill="none" stroke="url(#eye-grad)" stroke-width="2" stroke-linecap="round" filter="url(#soft-glow)"/>
  <!-- Iris ring -->
  <circle cx="140" cy="140" r="28" fill="none" stroke="url(#eye-grad)" stroke-width="1.5" opacity="0.7"/>
  <!-- Pupil -->
  <circle cx="140" cy="140" r="8" fill="#ffb800"/>
  <!-- Light refraction -->
  <circle cx="134" cy="133" r="2" fill="#fff" opacity="0.6"/>
  <circle cx="148" cy="136" r="1" fill="#fff" opacity="0.3"/>
</svg>
```

### Simplified (Extension Icon / Favicon)
```html
<svg width="80" height="80" viewBox="0 0 80 80">
  <defs>
    <linearGradient id="eg" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff6b2c"/>
      <stop offset="50%" stop-color="#ffb800"/>
      <stop offset="100%" stop-color="#ff3366"/>
    </linearGradient>
  </defs>
  <path d="M12 40 Q40 18 68 40" fill="none" stroke="url(#eg)" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M12 40 Q40 62 68 40" fill="none" stroke="url(#eg)" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="40" cy="40" r="6" fill="#ffb800"/>
  <circle cx="38" cy="38" r="1.5" fill="#fff" opacity="0.5"/>
</svg>
```

---

## 8. Responsive Breakpoints

```css
/* Mobile first */
@media (min-width: 640px)  { /* sm */ }
@media (min-width: 768px)  { /* md */ }
@media (min-width: 1024px) { /* lg */ }
@media (min-width: 1280px) { /* xl */ }
```

### Layout adjustments:
- **< 768px:** Single column layouts. Stat grids become 2-col. Feature grids become 1-col.
- **768px - 1024px:** Two-column grids. Nav collapses to hamburger.
- **> 1024px:** Full layouts. Max content width: 1200px.

---

## 9. Dark-on-Light (Inverse) Mode

For printed materials or light-background contexts:

| Token | Dark (default) | Light |
|---|---|---|
| Background | #080604 | #F5F0EB |
| Text primary | #FFFFFF | #1a1410 |
| Text body | #887766 | #665544 |
| Border | #1a1410 | #ddd5cc |
| Blaze | #FF6B2C | #CC4400 |
| Molten | #FFB800 | #CC9000 |
| Pulse | #FF3366 | #CC2244 |

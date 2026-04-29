# Design System

> Code-ready design tokens, CSS custom properties, and styling specifications.
> Used by Designer and Forge agents for visual consistency.
> **Source of truth:** `YClawAI/yclaw-style-guide` — this file is derived from it.

---

## 1. CSS Custom Properties

```css
:root {
  /* ======================== */
  /* COLORS                   */
  /* ======================== */

  /* Backgrounds */
  --brand-bg-primary: #0A0A0F;       /* Main page background */
  --brand-bg-card: #12121A;          /* Cards, panels, elevated surfaces */
  --brand-bg-elevated: #1A1A24;      /* Hover states, active cards, modals */
  --brand-bg-input: #0D0D14;         /* Input fields, textareas */

  /* Accents */
  --brand-primary: #00F0FF;          /* Cyan — primary CTA, active states */
  --brand-primary-hover: #33F3FF;    /* Cyan hover */
  --brand-primary-muted: #006670;    /* Subtle primary backgrounds, badges */
  --brand-secondary: #7B2FFF;        /* Purple — secondary accent, gradients */
  --brand-secondary-hover: #9555FF;  /* Purple hover */
  --brand-secondary-muted: #3B1678;  /* Subtle secondary backgrounds */

  /* Text */
  --brand-text-primary: #F0F0F5;     /* Headings, body text */
  --brand-text-secondary: #8888A0;   /* Subtitles, descriptions, meta */
  --brand-text-tertiary: #555570;    /* Placeholders, disabled text */
  --brand-text-inverse: #0A0A0F;     /* Text on primary/secondary backgrounds */

  /* Status */
  --brand-success: #00FF88;          /* Green — running, healthy, passed */
  --brand-warning: #FFB800;          /* Amber — degraded, warning, pending */
  --brand-error: #FF4444;            /* Red — failed, stopped, critical */
  --brand-info: #00CCFF;             /* Cyan-blue — informational */

  /* Borders */
  --brand-border: #2A2A3A;           /* Default borders, dividers */
  --brand-border-hover: #3A3A50;     /* Hovered borders */
  --brand-border-active: #00F0FF;    /* Focused/active borders (primary) */

  /* ======================== */
  /* TYPOGRAPHY               */
  /* ======================== */

  --font-display: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  --text-xs: 0.75rem;      /* 12px — badges, timestamps */
  --text-sm: 0.875rem;     /* 14px — body small, labels, meta */
  --text-base: 1rem;       /* 16px — body, inputs, list items */
  --text-lg: 1.125rem;     /* 18px — subheadings */
  --text-xl: 1.25rem;      /* 20px — card titles, section headers */
  --text-2xl: 1.5rem;      /* 24px — page section headers */
  --text-3xl: 1.875rem;    /* 30px — page titles */
  --text-4xl: 2.25rem;     /* 36px — hero headings */
  --text-5xl: 3rem;        /* 48px — landing hero */

  /* ======================== */
  /* SPACING                  */
  /* ======================== */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* ======================== */
  /* RADII                    */
  /* ======================== */
  --radius-sm: 4px;    /* Inputs */
  --radius-md: 6px;    /* Buttons, icon buttons */
  --radius-lg: 8px;    /* Cards */
  --radius-xl: 12px;   /* Modals */
  --radius-full: 9999px; /* Badges, pills */

  /* ======================== */
  /* SHADOWS                  */
  /* ======================== */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.4);
  --shadow-glow-sm: 0 0 8px rgba(0,240,255,0.15);
  --shadow-glow-md: 0 0 20px rgba(0,240,255,0.25);
  --shadow-glow-lg: 0 0 40px rgba(0,240,255,0.3);

  /* ======================== */
  /* GRADIENTS                */
  /* ======================== */
  --gradient-hero: linear-gradient(135deg, #00F0FF 0%, #7B2FFF 100%);
  --gradient-surface: linear-gradient(180deg, #12121A 0%, #0A0A0F 100%);

  /* ======================== */
  /* ANIMATION                */
  /* ======================== */
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
}
```

---

## 2. Typography Scale

| Role | Font | Weight | Size | Line Height | Letter Spacing |
|------|------|--------|------|-------------|----------------|
| Hero | Inter | 700 | 3rem (48px) | 1 | -0.02em |
| Headline | Inter | 700 | 2.25rem (36px) | 1.1 | -0.02em |
| Page Title | Inter | 700 | 1.875rem (30px) | 1.2 | -0.02em |
| Section | Inter | 600 | 1.5rem (24px) | 1.3 | -0.01em |
| Card Title | Inter | 600 | 1.25rem (20px) | 1.4 | 0 |
| Subhead | Inter | 500 | 1.125rem (18px) | 1.5 | 0 |
| Body | Inter | 400 | 1rem (16px) | 1.5 | 0 |
| Body Small | Inter | 400 | 0.875rem (14px) | 1.4 | 0 |
| Caption | Inter | 500 | 0.75rem (12px) | 1.4 | 0.05em |
| Mono | JetBrains Mono | 400 | 0.875rem (14px) | 1.5 | 0 |

---

## 3. Component Patterns

### Cards
```css
.card {
  background: var(--brand-bg-card);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  transition: border-color var(--duration-normal) var(--ease-out),
              background var(--duration-normal) var(--ease-out);
}
.card:hover {
  background: var(--brand-bg-elevated);
  border-color: var(--brand-border-hover);
}
.card--interactive:hover {
  cursor: pointer;
  box-shadow: var(--shadow-glow-sm);
}
```

### Buttons
- **Primary:** `var(--brand-primary)` bg, `var(--brand-text-inverse)` text, radius `var(--radius-md)`. Padding: 10px 24px, min-height 44px. Font: Inter 600, `var(--text-base)`. Hover: `var(--brand-primary-hover)`, scale 1.02. Focus: 2px `var(--brand-primary)` ring.
- **Secondary:** Transparent bg, 1px solid `var(--brand-border)`. Same sizing. Hover: bg → `var(--brand-bg-elevated)`, border → `var(--brand-border-hover)`.
- **Ghost:** Transparent bg, transparent border. Color: `var(--brand-text-secondary)`. Hover: bg → `var(--brand-bg-elevated)`, color → `var(--brand-text-primary)`.
- **Danger:** `var(--brand-error)` bg, white text. Only for destructive actions.
- **Disabled:** 40% opacity, no hover, cursor default.

### Inputs
```css
.input {
  background: var(--brand-bg-input);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-sm);
  color: var(--brand-text-primary);
  padding: 10px 14px;
  font: 400 var(--text-base) / 1.5 var(--font-body);
  height: 44px;
}
.input:focus {
  border-color: var(--brand-border-active);
  box-shadow: 0 0 0 2px rgba(0, 240, 255, 0.4);
  outline: none;
}
.input::placeholder { color: var(--brand-text-tertiary); }
.input--error { border-color: var(--brand-error); }
```

### Badges
```css
.badge {
  font: 500 var(--text-xs) / 1.4 var(--font-display);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.badge--department { background: var(--brand-primary-muted); color: var(--brand-primary); }
.badge--success { background: rgba(0, 255, 136, 0.1); color: var(--brand-success); }
.badge--error { background: rgba(255, 68, 68, 0.1); color: var(--brand-error); }
.badge--warning { background: rgba(255, 184, 0, 0.1); color: var(--brand-warning); }
```

### Agent Status Indicator
```css
.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.agent-dot--running { background: var(--brand-success); animation: pulse 2s infinite; }
.agent-dot--stopped { background: var(--brand-error); }
.agent-dot--idle { background: var(--brand-text-tertiary); }
.agent-dot--thinking { background: var(--brand-primary); animation: pulse-fast 1s infinite; }

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.6); opacity: 0; }
}
@keyframes pulse-fast {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.8); opacity: 0; }
}
```

### Terminal / Console
```css
.terminal {
  background: #05050A;
  color: var(--brand-text-primary);
  font: 400 var(--text-sm) / 1.5 var(--font-mono);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--brand-border);
}
.terminal .prompt { color: var(--brand-primary); }
.terminal .error { color: var(--brand-error); }
.terminal .success { color: var(--brand-success); }
```

---

## 4. Motion Principles

- **Default easing:** `var(--ease-out)` for interactions, `var(--ease-in-out)` for transitions.
- **Hover states:** `var(--duration-fast)` — must feel instant.
- **Page transitions & modals:** `var(--duration-normal)`.
- **No animation over 300ms** for interactive elements.
- **No motion on:** data tables, dense lists, elements repeating >10× per page.
- **Respect `prefers-reduced-motion`:** disable all animations when set.

---

## 5. Responsive Breakpoints

```css
/* Mobile-first. Build up, not down. */
@media (min-width: 640px)  { /* sm — small tablets */ }
@media (min-width: 768px)  { /* md — tablets */ }
@media (min-width: 1024px) { /* lg — desktop */ }
@media (min-width: 1280px) { /* xl — wide desktop */ }
```

---

## 6. Icon System

- **Library:** Lucide (MIT, 1400+ icons, stroke-only)
- **Stroke width:** 2px
- **Sizes:** 12px (inline), 16px (text-adjacent), 20px (default), 24px (feature), 32px (hero)
- **Color:** Inherit from parent text. Exceptions: status icons use semantic status colors.
- **Icon + text gap:** `var(--space-2)` (8px). Icon always precedes text.

---

## 7. Dark Mode Only

YCLAW is dark-first, not dual-theme. Agents run 24/7 — the UI respects the eyes.
No light mode toggle. No light mode variables. If asked, dark mode IS the mode.

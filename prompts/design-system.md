# Design System

> Code-ready design tokens, CSS custom properties, and styling specifications.
> Used by Designer and Forge agents for visual consistency.

---

## 1. CSS Custom Properties

```css
:root {
  /* ======================== */
  /* COLORS                   */
  /* ======================== */

  /* Backgrounds */
  --brand-bg-primary: #0D0D0D;       /* Near-black, obsidian base */
  --brand-bg-card: #1A1A1A;          /* Dark card surfaces */
  --brand-bg-elevated: #242424;      /* Elevated panels, modals */

  /* Accents */
  --brand-primary: #FF6B2B;          /* Blaze orange — primary CTA, highlights */
  --brand-secondary: #FF8F5C;        /* Warm amber — secondary accents */
  --brand-accent: #FFB088;           /* Soft glow — hover states, subtle warmth */

  /* Text */
  --brand-text-primary: #F5F5F5;     /* Near-white — headings, primary text */
  --brand-text-body: #CCCCCC;        /* Light gray — body text */
  --brand-text-secondary: #888888;   /* Mid gray — captions, metadata */

  /* Status */
  --brand-success: #4CAF50;          /* Green — success, approved */
  --brand-warning: #FF9800;          /* Amber — warning, flagged */
  --brand-error: #F44336;            /* Red — error, blocked */
  --brand-info: #2196F3;             /* Blue — informational */

  /* Borders */
  --brand-border: #333333;           /* Default borders */
  --brand-border-hover: #FF6B2B;     /* Border on hover — accent warmth */

  /* ======================== */
  /* TYPOGRAPHY               */
  /* ======================== */

  --font-display: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  --text-xs: 0.75rem;     /* 12px — captions */
  --text-sm: 0.875rem;    /* 14px — body small */
  --text-base: 1rem;      /* 16px — body */
  --text-lg: 1.125rem;    /* 18px — body large */
  --text-xl: 1.25rem;     /* 20px — section headers */
  --text-2xl: 1.5rem;     /* 24px — page headers */
  --text-3xl: 2rem;       /* 32px — hero headers */

  /* ======================== */
  /* SPACING                  */
  /* ======================== */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 40px;

  /* ======================== */
  /* RADII                    */
  /* ======================== */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* ======================== */
  /* SHADOWS                  */
  /* ======================== */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.4);
  --shadow-glow-sm: 0 0 8px rgba(255,107,43,0.15);
  --shadow-glow-lg: 0 0 20px rgba(255,107,43,0.25);

  /* ======================== */
  /* ANIMATION                */
  /* ======================== */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --duration-slow: 400ms;
}
```

---

## 2. Typography Scale

| Role | Font | Weight | Size | Line Height |
|------|------|--------|------|-------------|
| Headline | Inter | 700 | 2rem (32px) | 1.2 |
| Subhead | Inter | 600 | 1.5rem (24px) | 1.3 |
| Body | Inter | 400 | 1rem (16px) | 1.6 |
| Data | JetBrains Mono | 500 | 0.875rem (14px) | 1.5 |
| Label | Inter | 500 | 0.75rem (12px) | 1.4 |

---

## 3. Component Patterns

### Cards
Background `--brand-bg-card`, border `1px solid --brand-border`, radius `--radius-md`.
On hover: border transitions to `--brand-border-hover` with `--shadow-glow-sm`.

### Buttons
- **Primary:** `--brand-primary` bg, `--brand-text-primary` text, radius `--radius-md`. Hover: `--shadow-glow-lg`.
- **Secondary:** transparent bg, `1px solid --brand-border`, `--brand-text-body` text. Hover border: `--brand-border-hover`.
- **Ghost:** transparent bg + border, `--brand-text-body` text. Hover bg: `--brand-bg-elevated`.

### Inputs
Background `--brand-bg-elevated`, border `1px solid --brand-border`, radius `--radius-sm`.
Focus: border `--brand-primary`, `--shadow-glow-sm`.

---

## 4. Motion Principles

- **Default easing:** `--ease-default` for all state transitions.
- **Duration:** `--duration-fast` for hovers, `--duration-normal` for enter/exit, `--duration-slow` for hero animations.
- **No motion on:** data tables, dense lists, any element that repeats more than 10× on a page.

---

## 5. Responsive Breakpoints

```css
@media (min-width: 640px)  { /* sm */ }
@media (min-width: 768px)  { /* md */ }
@media (min-width: 1024px) { /* lg */ }
@media (min-width: 1280px) { /* xl */ }
```

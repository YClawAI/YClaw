<!-- CUSTOMIZE: Visual identity tokens for your organization -->
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
  --brand-bg-primary: #YOUR_COLOR;
  --brand-bg-card: #YOUR_COLOR;
  --brand-bg-elevated: #YOUR_COLOR;

  /* Accents */
  --brand-primary: #YOUR_COLOR;
  --brand-secondary: #YOUR_COLOR;
  --brand-accent: #YOUR_COLOR;

  /* Text */
  --brand-text-primary: #YOUR_COLOR;
  --brand-text-body: #YOUR_COLOR;
  --brand-text-secondary: #YOUR_COLOR;
  --brand-text-muted: #YOUR_COLOR;

  /* Borders */
  --brand-border: #YOUR_COLOR;
  --brand-border-hover: #YOUR_COLOR;

  /* ======================== */
  /* TYPOGRAPHY               */
  /* ======================== */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

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
  --radius-md: 10px;
  --radius-lg: 14px;

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
| Headline | [Font] | [Weight] | [Size] | [Line height] |
| Subhead | [Font] | [Weight] | [Size] | [Line height] |
| Body | [Font] | [Weight] | [Size] | [Line height] |
| Data | [Font] | [Weight] | [Size] | [Line height] |
| Label | [Font] | [Weight] | [Size] | [Line height] |

---

## 3. Component Patterns

### Cards
<!-- Define card styling: background, border, radius, hover behavior -->

### Buttons
<!-- Define button variants: primary, secondary, ghost -->

### Inputs
<!-- Define form input styling -->

---

## 4. Motion Principles

<!-- Define animation rules: easing, duration, what animates and what doesn't -->

---

## 5. Responsive Breakpoints

```css
@media (min-width: 640px)  { /* sm */ }
@media (min-width: 768px)  { /* md */ }
@media (min-width: 1024px) { /* lg */ }
@media (min-width: 1280px) { /* xl */ }
```

---
> See `examples/gaze-protocol/prompts/design-system.md` for a comprehensive real-world example with Tailwind config, SVG logos, and full component tokens.

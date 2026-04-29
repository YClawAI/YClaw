# Component Specifications

> How each component should look, behave, and animate. Reference this before building any component.
> Palette: Cyan (#00F0FF) primary, Purple (#7B2FFF) secondary, Dark backgrounds. See `design-system.md` for tokens.

---

## CSS Baselines

Canonical CSS snippets for the three primitive components (card, button, input) plus the float-up animation. Use these values as the source of truth for any variant built on top.

### Card

```css
.card {
  background: var(--brand-bg-card);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-lg);
  padding: 20px;
  transition: border-color 200ms var(--ease-out),
              box-shadow 200ms var(--ease-out);
}
.card:hover {
  border-color: var(--brand-border-hover);
  background: var(--brand-bg-elevated);
  box-shadow: var(--shadow-glow-sm);
}
```

### Buttons

```css
.btn-primary {
  background: var(--brand-primary);
  color: var(--brand-text-inverse);
  border: none;
  border-radius: var(--radius-md);
  padding: 10px 24px;
  font-weight: 600;
  min-height: 44px;
  transition: background 150ms var(--ease-out), transform 150ms var(--ease-out);
}
.btn-primary:hover { background: var(--brand-primary-hover); transform: scale(1.02); }
.btn-primary:active { transform: scale(0.98); }
.btn-primary:focus-visible { box-shadow: 0 0 0 2px var(--brand-primary); outline: none; }
.btn-primary:disabled { opacity: 0.4; cursor: default; transform: none; }

.btn-secondary {
  background: transparent;
  color: var(--brand-text-primary);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-md);
  padding: 10px 24px;
  min-height: 44px;
}
.btn-secondary:hover {
  background: var(--brand-bg-elevated);
  border-color: var(--brand-border-hover);
}

.btn-ghost {
  background: transparent;
  color: var(--brand-text-secondary);
  border: none;
  padding: 8px 16px;
}
.btn-ghost:hover {
  background: var(--brand-bg-elevated);
  color: var(--brand-text-primary);
}

.btn-danger {
  background: var(--brand-error);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  padding: 10px 24px;
  font-weight: 600;
  min-height: 44px;
}
```

### Form Input

```css
.input {
  background: var(--brand-bg-input);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-sm);
  color: var(--brand-text-primary);
  padding: 10px 14px;
  font: 400 16px/1.5 var(--font-body);
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

### Animation: float-up

```css
@keyframes float-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* Duration: 300ms, Easing: var(--ease-out) */
/* Stagger: 100ms per element */
/* Never slide horizontally. Fade + subtle vertical only. */
/* Respect prefers-reduced-motion: disable entirely. */
```

---

## Shared Patterns

### Hover Behavior
All interactive elements:
- Border transitions from `var(--brand-border)` to `var(--brand-border-hover)` over `var(--duration-fast)`
- Glow: faint box-shadow appears (`var(--shadow-glow-sm)`)
- **Never snap.** Always transition.
- Easing: `var(--ease-out)`

### Loading States
- Skeleton screens use `var(--brand-bg-elevated)` with a subtle pulse animation
- Never show spinners. Use skeleton shapes that match the final content.
- Gradient shimmer moves left-to-right: `linear-gradient(90deg, transparent, rgba(0,240,255,0.05), transparent)`
- Skeleton border-radius matches the component it replaces

### Transitions Between Pages
- Content fades in (`float-up` animation, 300ms, staggered by 100ms per element)
- **Never slide.** Fade only.
- Sections appear in order: label → title → content → interactive elements

---

## Navigation

### Desktop Nav
```
[Logo] [YClaw]     [Dashboard] [Agents] [Events] [Docs]     [Connect]
```

- Fixed to top, `backdrop-filter: blur(12px)`, `var(--brand-bg-primary)` at 90% opacity
- Logo icon: YClaw mark SVG (20px), cyan primary fill
- Wordmark: Inter Bold, 24px, `var(--gradient-hero)` fill
- Links: Inter 500, 14px, `var(--brand-text-secondary)`, hover → `var(--brand-primary)`
- CTA button: Ghost style, hover border → `var(--brand-primary)`
- Height: 56px, padding: 0 24px

### Mobile Nav
- Hamburger icon (three thin lines, `var(--brand-text-secondary)`)
- Opens full-screen overlay with `var(--brand-bg-primary)` background
- Links centered, 18px, stacked vertically, `var(--space-4)` gap
- Logo centered at top of overlay

### User / Operator Connection
- "Connect" button in nav (ghost style)
- Connected state: Username in JetBrains Mono + role badge (operator/admin)
- Dropdown on click: username, role, settings, disconnect

---

## Logo Component

Reusable SVG component with configurable size and animation.

### Props
```typescript
interface LogoProps {
  size: 'xs' | 'sm' | 'md' | 'lg' | 'hero';  // 12, 16, 24, 48, 280px
  animate?: boolean;          // default true for hero, false for others
  variant?: 'full' | 'simple' | 'mono';  // default 'full'
  className?: string;
}
```

### Size Behavior
- **xs (12px):** Footer, inline references. Simple variant, no glow.
- **sm (16px):** Nav, extension header. Simple variant, subtle glow.
- **md (24px):** Section headers, cards. Full variant, subtle animation.
- **lg (48px):** Feature sections. Full variant, full animation.
- **hero (280px):** Landing page hero. Full variant, all animations.

### Color Rules
- Primary fill: `var(--brand-primary)` (#00F0FF)
- Secondary fill: `var(--brand-secondary)` (#7B2FFF) for depth elements
- Mono variant: `var(--brand-text-primary)` only
- Glow: `var(--shadow-glow-md)` on lg+ sizes

### Animation Rules
- The logo shape never moves or rotates
- Inner elements can pulse (scale 1→1.05, 3s infinite)
- Glow effects can breathe (opacity 0.8→1, 4s infinite)
- Static decorative elements remain fixed

---

## Data Card

Used in listing page grids. Customize fields for your domain.

### Layout
```
[Icon]  [Name]          [Primary Metric]    [Change Indicator]
        [Subtitle]      [Secondary Metric]  [Tertiary Metric]
```

### Icon
- 48px, `var(--radius-lg)` (8px radius)
- Background: `var(--brand-bg-elevated)`
- Border: 1px solid `var(--brand-border)`
- Content: First letter of item name, `var(--brand-text-primary)`

### Data Display
- Primary metric: JetBrains Mono, 20px, weight 500, `var(--brand-text-primary)`
- Change indicator: JetBrains Mono, 12px, positive = `var(--brand-success)`, negative = `var(--brand-error)`
- Secondary metrics: JetBrains Mono, 12px, `var(--brand-text-secondary)`

### Hover
- Border transitions to `var(--brand-border-hover)`
- Faint card glow appears (`var(--shadow-glow-sm)`)
- TranslateY(-2px)

---

## Time-Series Chart

### Visual Style
- Line: 1.5px stroke, `var(--gradient-hero)` (cyan → purple)
- Fill: Same gradient, 10% opacity at top fading to 0% at bottom
- Background: `var(--brand-bg-elevated)` with `var(--brand-border)`
- Border radius: `var(--radius-md)`

### Timeframe Tabs
- Options: 1H, 4H, 1D, 1W, 1M, ALL
- Active tab: `var(--brand-primary)` text
- Inactive: `var(--brand-text-secondary)` text
- Tab style: no background, just text color change

### Crosshair / Tooltip
- Vertical line: 1px, `var(--brand-text-tertiary)`
- Tooltip: `var(--brand-bg-card)`, border, shows value + timestamp
- Value in JetBrains Mono with `var(--brand-text-primary)` color

---

## Action Panel

Right sidebar or modal for primary user interactions (agent management, task dispatch, approvals).

### Tabs
```
[Dispatch]  [Config]  [Approvals]
```
- Active tab: `var(--brand-primary)` text + 2px bottom border in `var(--brand-primary)`
- Inactive: `var(--brand-text-secondary)` text

### Task Dispatch Form
```
[Agent Selector]        [dropdown]
[Task Description]      [textarea]
[Priority: P0-P3]      [selector]

[Dispatch Task]  (primary button)
```

### Agent Config Form
```
[Model]     [dropdown]
Prompts:    [mission_statement.md, ...]  [Edit]
Schedule:   [Cron Expression]
Budget:     [$50/day]

[Save Config]  (primary button)
```

### Approval Queue Section
```
Pending Approvals:   3
Oldest:              2m ago
Risk Level:          HIGH

[Review & Approve]  (primary button)
```

---

## Activity Feed

Used on agent detail pages and org-wide dashboard.

### Row Layout
```
[Type Icon]  [Description]                    [Status]     [Time]
```

### Type Icons
- Small circles (8px) or small icons (16px) with type-specific color:
  - Success: `var(--brand-success)`
  - Failure: `var(--brand-error)`
  - In progress: `var(--brand-primary)` with pulse animation
  - Idle: `var(--brand-text-tertiary)`
  - Approval needed: `var(--brand-warning)` with glow

### Description Format
Agent activity descriptions:
- "[agent] completed [task] — [result summary]"
- "[agent] published event [type] → [target]"

### Time Format
- Recent: "2m ago", "1h ago"
- Older: "Feb 11" or "Feb 11, 2026"

---

## Ranked Table

### Header
- JetBrains Mono, 12px, `var(--brand-text-secondary)`, uppercase, letter-spacing 0.05em

### Rows
- Rank: JetBrains Mono, weight 600. Top 3 get `var(--gradient-hero)` text fill.
- Name: Inter 400, `var(--brand-text-primary)`. Truncate with ellipsis.
- Primary metric: JetBrains Mono 500, `var(--brand-text-primary)`.
- Secondary metric: JetBrains Mono 400, `var(--brand-text-secondary)`.

### Current User Row
- Highlighted with `var(--brand-primary)` 2px left border
- Background: `var(--brand-bg-elevated)`
- "You" badge next to name (`var(--brand-primary-muted)` bg, `var(--brand-primary)` text)

---

## Stats Bar

Horizontal row of key metrics (used on landing page and dashboard).

### Layout
```
[13]                 [847]                [99.2%]            [6]
Active Agents        Tasks Completed      Uptime             Departments
```

- Value: JetBrains Mono, 28px, weight 600, `var(--gradient-hero)` fill
- Label: 12px, `var(--brand-text-secondary)`, uppercase, letter-spacing 0.05em
- Separated by 1px vertical borders (`var(--brand-border)`)
- Each cell centered, equal width

---

## Notification Toast

### Layout
```
[Logo]  [YClaw]                           [2m ago]
[Title — Inter 600, var(--brand-text-primary)]
[Description — Inter 400, var(--brand-text-secondary)]
[Action Button (optional)]
```

### Behavior
- Slides in from top-right (200ms, `var(--ease-out)`)
- Auto-dismisses after 5 seconds
- Hover pauses the dismiss timer
- Close button (X) in top right, `var(--brand-text-secondary)`
- Background: `var(--brand-bg-card)`, border: `var(--brand-border)`
- Max width: 380px, radius: `var(--radius-lg)`

---

## Org Summary Cards

### Card Grid (2x2)
```
[Active Agents]         [Tasks Today]
 13 / 13 online          47 completed

[Pending Approvals]     [LLM Spend (24h)]
 3 awaiting review       $12.84
```

### Card Style
- Background: `var(--brand-bg-card)`
- Border: `var(--brand-border)`
- Radius: `var(--radius-lg)`
- Value: JetBrains Mono, 24px, `var(--brand-text-primary)`
- Label: 12px, `var(--brand-text-secondary)`, uppercase
- Highest-priority card: subtle `var(--shadow-glow-sm)` border glow

---

## Priority Selector

- Row of small pills: [P0] [P1] [P2] [P3]
- Active: `var(--brand-bg-elevated)` background + `var(--brand-primary)` border
- Inactive: `var(--brand-border)` border, `var(--brand-text-secondary)` text
- P0 active: `var(--brand-error)` border (critical priority)

---

## Modals

### Overlay
- Background: rgba(0, 0, 0, 0.8) + `backdrop-filter: blur(12px)`

### Modal Box
- Background: `var(--brand-bg-card)`
- Border: `var(--brand-border)`
- Radius: `var(--radius-xl)` (12px)
- Max width: 480px
- Padding: 24px
- Close button: top-right, ghost style

### Animation
- Overlay fades in (200ms)
- Modal fades in + translateY from 20px (200ms, `var(--ease-out)`)
- Close: reverse, 150ms

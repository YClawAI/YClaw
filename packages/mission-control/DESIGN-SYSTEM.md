# Mission Control — Design System Reference

> Visual design system for the YClaw Mission Control dashboard.
> **SpaceX Crew Dragon aesthetic** — pure black canvas, 1px cyan hairline
> borders, outlined (not filled) panels, Inter ultralight for UI and
> JetBrains Mono for data. Adopted 2026-04-16 (decision record in
> `outputs/SPACEX_COVERAGE_GAP.md`).

---

## Migration Status (Phase 1 of 6)

The package is mid-migration from the legacy `terminal-*` Catppuccin-ish
palette to the SpaceX `mc-*` system. During migration both palettes are
defined in `tailwind.config.ts` and both work everywhere.

| Phase | Status | Scope |
|---|---|---|
| 1. Tokens, primitives, docs | ✅ (this PR) | `mc-*` tokens live; `terminal-*` untouched; `src/components/ui/` primitives added |
| 2. Home dashboard + hive viz | pending | `src/app/page.tsx`, `src/components/hive/*`, live-activity, alert-board, kpi-card, org-sidecar |
| 3. Shell | pending | Sidebar, openclaw chat, settings drawer, fleet banner |
| 4. Department pages | pending | `src/app/departments/*` + dept-specific components |
| 5. System pages | pending | `src/app/system/*`, operators, onboarding, login, AgentHub, Design Studio |
| 6. Cleanup | pending | Delete `terminal-*` tokens; reduced-motion audit; empty/loading state polish |

**Rule of thumb while migrating:** don't mix palettes inside a single
file. A file either uses `terminal-*` or `mc-*` — not both. When a file
is migrated, flip all of it in one commit.

---

## Color Tokens (SpaceX — `mc-*`)

Defined in `tailwind.config.ts` under `theme.extend.colors.mc`, and
mirrored as CSS custom properties in `globals.css` for inline-SVG /
computed-color use.

### Surfaces

| Token | Value | Usage |
|---|---|---|
| `mc-bg` | `#000000` | Page background (pure black) |
| `mc-surface` | `rgba(255,255,255,0.02)` | Optional "glass" panel tint |
| `mc-surface-hover` | `rgba(255,255,255,0.04)` | Row hover / sidebar item hover |

### Borders (the signature)

Every panel, card, input, and drawer gets a 1px cyan hairline border.
Fills are the exception, not the rule.

| Token | Value | Usage |
|---|---|---|
| `mc-border` | `rgba(90,200,250,0.12)` | Default panel + input border |
| `mc-border-hover` | `rgba(90,200,250,0.22)` | Interactive panel hover |
| `mc-border-active` | `rgba(90,200,250,0.40)` | Focused input / active selection |

### Text

| Token | Value | Usage |
|---|---|---|
| `mc-text` | `rgba(255,255,255,0.87)` | Primary body + numerics |
| `mc-text-secondary` | `rgba(255,255,255,0.50)` | Secondary body, timestamps |
| `mc-text-tertiary` | `rgba(255,255,255,0.30)` | Metadata, disabled, annotations |
| `mc-text-label` | `rgba(255,255,255,0.35)` | Uppercase section labels |

### Accent + Semantic

| Token | Value | Usage |
|---|---|---|
| `mc-accent` | `#5AC8FA` | Brand cyan — buttons, focus rings, key CTAs |
| `mc-accent-dim` | `rgba(90,200,250,0.15)` | Active chip wash, highlighted rows |
| `mc-success` | `#30D158` | Healthy, active, passing |
| `mc-danger` | `#FF453A` | Error, kill switch, overspend |
| `mc-warning` | `#FFD60A` | Pending review, caution, idle |
| `mc-info` | `#64D2FF` | Informational notices |
| `mc-blocked` | `#FF9F0A` | Blocked, offline, stale |

### Department Colors

**These changed in Phase 1.** Every dept-color reference in the app
will migrate to these tokens during Phases 2–5.

| Department | Old (`terminal-*`) | New (`mc-*`) | Token |
|---|---|---|---|
| Executive | `terminal-cyan` `#89dceb` | `#FFD60A` yellow | `mc-dept-executive` |
| Development | `terminal-blue` `#89b4fa` | `#5AC8FA` cyan | `mc-dept-development` |
| Marketing | `terminal-orange` `#fab387` | `#FF9F0A` amber | `mc-dept-marketing` |
| Operations | `terminal-green` `#a6e3a1` | `#30D158` iOS green | `mc-dept-operations` |
| Finance | `terminal-purple` `#cba6f7` | `#BF5AF2` iOS purple | `mc-dept-finance` |
| Support | `terminal-yellow` `#f9e2af` | `#64D2FF` light cyan | `mc-dept-support` |

The brand pivot here is purple → cyan: mission control reads as
telemetry, not mystique.

---

## Typography

The monospace-everywhere rule is gone. UI labels and headings are
**Inter ultralight (200–400)**; data, IDs, counts, and code stay in
**JetBrains Mono**. Both are loaded via `next/font/google` in
`src/app/layout.tsx` as the CSS variables `--font-inter` and
`--font-jetbrains-mono`.

| Context | Classes |
|---|---|
| Section label (uppercase) | `font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label` |
| Panel title | `font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label` |
| Page heading | `font-sans text-xl font-extralight text-mc-text` |
| Primary body | `font-sans text-xs text-mc-text` |
| Secondary body | `font-sans text-[11px] text-mc-text-secondary` |
| Metric value | `font-mono text-2xl text-mc-text tabular-nums` |
| Inline code / IDs | `font-mono text-xs text-mc-text` |
| Timestamps | `font-mono text-[11px] text-mc-text-tertiary tabular-nums` |

Letter spacing for uppercase labels is standardized via the custom
`tracking-label` utility (0.12em).

---

## Layout Primitives

Import from `@/components/ui`. These wrap the Tailwind recipes below
so callers don't reinvent the outlined-panel look on every surface.

### `<Panel>`
Outlined container. Variants: `static` (default), `interactive` (hover
brightens border), `glass` (2% white surface tint). Pass `department`
for a tinted-border panel on department pages. Optional `title` +
`actions` slots render the standard panel header row.

### `<Toggle>`
Accent-glow switch for settings. Variants: `accent` (default cyan),
`success`, `warning`, `danger` (kill-switch style).

### `<Chip>`
Compact pill for integrations, status badges, filters. `tone="outline"`
(default) or `tone="solid"`; semantic variants (`success`, `warning`,
`danger`, `info`, `blocked`, `accent`). Pass `mono` for a data-tag
chip (monospace, not uppercase).

### `<SliderField>`
Creativity/risk/threshold slider. Cyan track fill, haloed thumb,
tabular-nums readout.

### `<Metric>`
The tile in the top-of-dashboard metrics strip. Label + value +
optional trend + accent rule on top-left. Accent colors include every
department token so per-department dashboards tint correctly.

---

## Component Recipes

For cases where a primitive isn't enough, these are the canonical
class strings. Reach for `<Panel>` first.

### Card / Panel
```
border border-mc-border rounded-panel bg-transparent p-4
transition-colors duration-mc ease-mc-out
hover:border-mc-border-hover
```

### Status Badge
```
inline-flex items-center gap-1.5 h-6 px-2 rounded-chip border
font-sans text-[10px] font-medium uppercase tracking-label
border-mc-{success|warning|danger|info|blocked}/40
text-mc-{success|warning|danger|info|blocked}
```

### Health Dot
```
inline-block w-2 h-2 rounded-full bg-mc-{success|warning|danger}
shadow-[0_0_6px_currentColor]
```

### Button (Primary)
```
px-3 py-1.5 rounded-chip border border-mc-accent/40
font-sans text-xs font-medium text-mc-accent
bg-mc-accent-dim hover:bg-mc-accent/25
transition-colors duration-mc ease-mc-out
focus-visible:outline focus-visible:outline-2 focus-visible:outline-mc-accent
```

### Button (Ghost)
```
px-3 py-1.5 rounded-chip border border-mc-border
font-sans text-xs text-mc-text-secondary
hover:border-mc-border-hover hover:text-mc-text
transition-colors duration-mc ease-mc-out
```

### Input
```
bg-transparent border border-mc-border rounded-chip px-3 py-1.5
font-mono text-xs text-mc-text placeholder:text-mc-text-tertiary
focus:outline-none focus:border-mc-border-active
transition-colors duration-mc ease-mc-out
```

### Modal / Drawer Overlay
```
fixed inset-0 z-50 bg-black/60 backdrop-blur-sm
```

### Modal / Drawer Panel
```
border border-mc-border rounded-panel bg-mc-bg shadow-2xl
```

### Table
```
outer: border border-mc-border rounded-panel overflow-hidden
rows:  divide-y divide-mc-border
row:   px-4 py-2.5 hover:bg-mc-surface-hover transition-colors
data:  font-mono text-xs text-mc-text tabular-nums
```

### Progress Bar
```
outer: h-px bg-mc-border
inner: h-px bg-mc-{accent|success|warning|danger}
```

---

## Spacing

| Context | Value |
|---|---|
| Main content padding | `p-6` |
| Section gaps | `mb-6` (standard), `mb-8` (between department groups) |
| Card padding | `p-4` (standard), `p-5` (hero panels) |
| Grid gaps | `gap-3` (cards), `gap-4` (metric strip) |
| Panel radius | `rounded-panel` = 8px |
| Chip radius | `rounded-chip` = 6px |
| Badge radius | `rounded-badge` = 3px |

---

## Animation

Every animation below respects `prefers-reduced-motion: reduce` — the
global media query in `globals.css` sets `animation: none` and clamps
transitions to 0.01ms when the user has the OS preference on. **Do not
add a new animation without verifying it degrades gracefully.**

| Pattern | Implementation |
|---|---|
| Live health pulse | `animate-mc-pulse` on the dot |
| Breathing glow (active agents) | `animate-mc-breathe` |
| Communication particle | `animate-mc-particle-flow` along an SVG path |
| Interactive hover | `transition-colors duration-mc ease-mc-out` |
| Drawer slide | `300ms cubic-bezier(0.16, 1, 0.3, 1)` |

The easing curve `ease-mc-out` (`cubic-bezier(0.16, 1, 0.3, 1)`) is the
house standard; use `duration-mc` (220ms) for hover/focus and 300ms
only for drawers and modals.

---

## Legacy — `terminal-*`

The old tokens are still defined in `tailwind.config.ts` so every
un-migrated component continues to render. They are **frozen**: don't
write new components against `terminal-*`, and don't adjust the values.
The entire namespace is removed in Phase 6 once every file has been
migrated.

Token mapping (old → new), for reference during file-by-file migration:

| Old | New | Notes |
|---|---|---|
| `terminal-bg` | `mc-bg` | Pure black instead of near-black |
| `terminal-surface` | `mc-surface` + outlined border | Surfaces outline, not fill |
| `terminal-border` | `mc-border` | 1px cyan hairline |
| `terminal-muted` | `mc-surface-hover` | Hover-row tint |
| `terminal-text` | `mc-text` | |
| `terminal-dim` | `mc-text-secondary` | |
| `terminal-green` | `mc-success` | |
| `terminal-red` | `mc-danger` | |
| `terminal-yellow` | `mc-warning` | |
| `terminal-blue` | `mc-info` | For neutral info; see dept table for dev department |
| `terminal-purple` | `mc-accent` | Brand shift purple → cyan |
| `terminal-cyan` | (see dept remap) | No direct equivalent |
| `terminal-orange` | `mc-blocked` | |

---

## Existing Components (Reused Across Migration)

These stay functionally identical; only their styling migrates. Do not
rewrite their APIs.

- `ChatPanel`, `StatusBadge`, `BurnVelocity`, `SpendFlow`,
  `BudgetEditor`, `BudgetModeToggle`, `GlobalBudgetCard`,
  `BudgetOverview`, `WhatIfSimulator`, `TokenMap`, `FleetKillSwitch`,
  `RefreshTrigger`, `SystemBadge`

# Mission Control — Complete Style Guide

> Implementation-level style guide for the YClaw Mission Control
> dashboard. **SpaceX Crew Dragon aesthetic** — pure black canvas, 1px
> cyan hairline borders, outlined (not filled) panels, Inter ultralight
> for UI + JetBrains Mono for data. Adopted 2026-04-16.
>
> Companion: `DESIGN-SYSTEM.md` covers tokens and primitives at a
> higher level. This file covers the copy-paste class strings and
> patterns.

---

## Migration Status

The package is mid-migration from `terminal-*` (legacy Catppuccin-ish
palette) to `mc-*` (SpaceX system). Both palettes live in
`tailwind.config.ts` so un-migrated components still render.

When you touch a file, migrate it entirely in the same commit — don't
mix palettes inside a single file. Migration phases are tracked in
`DESIGN-SYSTEM.md`.

---

## Tech Stack

- **Framework:** Next.js 14 (App Router, Server Components + Client Islands)
- **Styling:** Tailwind CSS (dark mode via `class`)
- **Fonts:** Inter (sans, 200–600) and JetBrains Mono (300–500), loaded
  via `next/font/google` as CSS variables `--font-inter` and
  `--font-jetbrains-mono`. Tailwind's `font-sans` / `font-mono`
  utilities resolve to these.
- **Data:** Server Components with 30s revalidation + SSE overlay for
  real-time
- **State:** React hooks + Zustand stores (e.g., `chat-store`)
- **Package:** `packages/mission-control/` in the `YClawAI/YClaw` monorepo

---

## Color Palette — `mc-*`

Defined in `tailwind.config.ts` → `theme.extend.colors.mc`, and
mirrored as CSS custom properties in `globals.css`.

### Surfaces

| Token | Value | Usage |
|---|---|---|
| `mc-bg` | `#000000` | Page background |
| `mc-surface` | `rgba(255,255,255,0.02)` | Glass-tint panels (opt-in) |
| `mc-surface-hover` | `rgba(255,255,255,0.04)` | Row hover, sidebar hover |

### Borders

| Token | Value | Usage |
|---|---|---|
| `mc-border` | `rgba(90,200,250,0.12)` | Default — 1px hairline everywhere |
| `mc-border-hover` | `rgba(90,200,250,0.22)` | Interactive panel hover |
| `mc-border-active` | `rgba(90,200,250,0.40)` | Focus / active selection |

### Text

| Token | Value | Usage |
|---|---|---|
| `mc-text` | `rgba(255,255,255,0.87)` | Primary body, metric values |
| `mc-text-secondary` | `rgba(255,255,255,0.50)` | Secondary body |
| `mc-text-tertiary` | `rgba(255,255,255,0.30)` | Metadata, annotations |
| `mc-text-label` | `rgba(255,255,255,0.35)` | Uppercase section labels |

### Accent + Semantic

| Token | Value | Usage |
|---|---|---|
| `mc-accent` | `#5AC8FA` | Brand cyan — buttons, focus, key CTAs |
| `mc-accent-dim` | `rgba(90,200,250,0.15)` | Active chip wash, highlight row |
| `mc-success` | `#30D158` | Active, healthy, passing |
| `mc-danger` | `#FF453A` | Error, kill switch, overspend |
| `mc-warning` | `#FFD60A` | Pending, caution |
| `mc-info` | `#64D2FF` | Informational notice |
| `mc-blocked` | `#FF9F0A` | Blocked, stale, offline |

### Department Colors

| Department | Token | Hex |
|---|---|---|
| Executive | `mc-dept-executive` | `#FFD60A` (yellow) |
| Development | `mc-dept-development` | `#5AC8FA` (cyan) |
| Marketing | `mc-dept-marketing` | `#FF9F0A` (amber) |
| Operations | `mc-dept-operations` | `#30D158` (iOS green) |
| Finance | `mc-dept-finance` | `#BF5AF2` (iOS purple) |
| Support | `mc-dept-support` | `#64D2FF` (light cyan) |

---

## Typography

The monospace-everywhere rule is gone. Inter ultralight (200–400) for
UI chrome and headings; JetBrains Mono for IDs, metrics, timestamps,
code.

| Context | Classes |
|---|---|
| Page title | `font-sans text-xl font-extralight text-mc-text` |
| Page subtitle | `font-sans text-xs text-mc-text-secondary` |
| Section label (uppercase) | `font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label` |
| Panel title | `font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label` |
| Primary body text | `font-sans text-xs text-mc-text` |
| Secondary body text | `font-sans text-[11px] text-mc-text-secondary` |
| Tiny annotations | `font-sans text-[10px] text-mc-text-tertiary` |
| Metric value | `font-mono text-2xl text-mc-text tabular-nums` |
| Inline data / IDs | `font-mono text-xs text-mc-text` |
| Timestamps | `font-mono text-[11px] text-mc-text-tertiary tabular-nums` |
| Drawer section label | `font-sans text-xs font-medium uppercase tracking-label text-mc-text` |
| Drawer sub-header | `font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label` |

`tracking-label` = `0.12em`, defined in `tailwind.config.ts`.

---

## Spacing

| Context | Value |
|---|---|
| Main content padding | `p-6` |
| Section gaps | `mb-6` (standard), `mb-8` (between department groups) |
| Card padding | `p-4` (standard), `p-5` (hero panels) |
| Grid gaps | `gap-3` (cards), `gap-4` (metric strip), `gap-6` (major sections) |
| Drawer internal padding | `p-6` |
| Drawer section gaps | `mb-6` |
| Panel radius | `rounded-panel` = 8px |
| Chip radius | `rounded-chip` = 6px |
| Badge radius | `rounded-badge` = 3px |

---

## Primitives (`@/components/ui`)

Prefer these over the recipes below wherever they fit:

| Primitive | Use for |
|---|---|
| `<Panel>` | Any outlined container — cards, hero panels, sections |
| `<Toggle>` | On/off switch in settings |
| `<Chip>` | Integration tags, status badges, filter pills |
| `<SliderField>` | Creativity / risk / threshold sliders |
| `<Metric>` | Top-of-dashboard metric tiles, per-department KPIs |

---

## Component Recipes (when a primitive doesn't fit)

### Card / Panel

```
border border-mc-border rounded-panel bg-transparent p-4
transition-colors duration-mc ease-mc-out
hover:border-mc-border-hover
```

Accent-bordered panel (e.g. OpenClaw):
```
border border-mc-accent/30 rounded-panel bg-transparent p-5
```

Department-bordered panel:
```
border border-mc-dept-{dept}/25 rounded-panel bg-transparent p-5
```

### Stat Block (inside cards)

```
px-3 py-2 border-l border-mc-border
```

Inner layout: `font-mono text-2xl text-mc-text tabular-nums` value
above `font-sans text-[10px] uppercase tracking-label text-mc-text-label`
label.

### Status Badge

```
inline-flex items-center gap-1.5 h-6 px-2 rounded-chip border
font-sans text-[10px] font-medium uppercase tracking-label
border-mc-{success|warning|danger|info|blocked}/40
text-mc-{success|warning|danger|info|blocked}
```

Status map:

| Status | Token |
|---|---|
| active, running | `mc-success` |
| completed, merged | `mc-info` |
| failed, error | `mc-danger` |
| pending, queued | `mc-warning` |
| review | `mc-accent` |
| blocked, stale | `mc-blocked` |
| idle | `mc-text-tertiary` |

### Health Dot

```
inline-block w-2 h-2 rounded-full bg-mc-{success|warning|danger}
shadow-[0_0_6px_currentColor]
```

For live-pulse effect, add `animate-mc-pulse`.

### Button — Primary

```
px-3 py-1.5 rounded-chip border border-mc-accent/40
bg-mc-accent-dim hover:bg-mc-accent/25
font-sans text-xs font-medium text-mc-accent
transition-colors duration-mc ease-mc-out
focus-visible:outline focus-visible:outline-2 focus-visible:outline-mc-accent focus-visible:outline-offset-2
```

### Button — Ghost

```
px-3 py-1.5 rounded-chip border border-mc-border
font-sans text-xs text-mc-text-secondary
hover:border-mc-border-hover hover:text-mc-text
transition-colors duration-mc ease-mc-out
```

### Button — Danger

```
px-3 py-1.5 rounded-chip border border-mc-danger/40
bg-mc-danger/10 hover:bg-mc-danger/20
font-sans text-xs font-medium text-mc-danger
transition-colors duration-mc ease-mc-out
```

### Button — Toggle (on/off state)

Off:
```
border-mc-border text-mc-text-secondary hover:border-mc-border-hover
```

On (positive):
```
border-mc-success/50 bg-mc-success/10 text-mc-success
```

On (destructive):
```
border-mc-danger/50 bg-mc-danger/10 text-mc-danger
```

### Input

```
bg-transparent border border-mc-border rounded-chip px-3 py-1.5
font-mono text-xs text-mc-text placeholder:text-mc-text-tertiary
focus:outline-none focus:border-mc-border-active
transition-colors duration-mc ease-mc-out
```

### Progress Bar

```
outer: w-full h-px bg-mc-border
inner: h-px transition-all duration-mc ease-mc-out
```

Thresholds:
- `>90%` → `bg-mc-danger`
- `>warn%` → `bg-mc-warning`
- default → `bg-mc-success`

### List Items

```
divide-y divide-mc-border
(each): px-4 py-2.5 hover:bg-mc-surface-hover transition-colors duration-mc
```

### Modal / Drawer Overlay

```
fixed inset-0 z-50 bg-black/60 backdrop-blur-sm
```

### Modal / Drawer Panel

```
border border-mc-border rounded-panel bg-mc-bg shadow-2xl
```

---

## Page Header Pattern

```tsx
<div className="flex items-center justify-between mb-6">
  <h1 className="font-sans text-xl font-extralight text-mc-text tracking-tight">Page Title</h1>
  <div className="flex items-center gap-2">
    <button className="px-3 py-1.5 rounded-chip border border-mc-border font-sans text-xs text-mc-text-secondary hover:border-mc-border-hover hover:text-mc-text transition-colors duration-mc ease-mc-out">
      Settings
    </button>
  </div>
</div>
```

Accent-colored titles (OpenClaw):

```tsx
<h1 className="font-sans text-xl font-extralight text-mc-accent tracking-tight">OpenClaw</h1>
```

---

## Settings Drawer Pattern

### Container

```tsx
<SettingsDrawer open={open} onClose={() => setOpen(false)} title="Page Settings">
  {/* Accordion sections */}
</SettingsDrawer>
```

Behavior (unchanged from legacy):
- **Position:** Right-side overlay, `max-w-md`, z-50
- **Mobile:** Bottom sheet with `max-h-[80vh]`, rounded top
- **Background:** `bg-mc-bg`, left border `border-mc-border`
- **Backdrop:** `bg-black/60 backdrop-blur-sm`, click-to-close
- **Escape key** closes drawer
- **Body scroll** locked when open
- **Sticky header:** title + × close button

### Trigger Button

Always a text-labeled ghost button. **Never use emoji.**

```tsx
<button
  onClick={() => setOpen(true)}
  className="px-3 py-1.5 rounded-chip border border-mc-border font-sans text-xs text-mc-text-secondary hover:border-mc-border-hover hover:text-mc-text transition-colors duration-mc ease-mc-out"
>
  Settings
</button>
```

### Accordion Sections

```tsx
<section className="mb-6">
  <button
    onClick={() => toggleSection('sectionKey')}
    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-chip border transition-colors duration-mc ease-mc-out ${
      expanded
        ? 'border-mc-accent/40 bg-mc-accent-dim'
        : 'border-mc-border hover:border-mc-border-hover'
    }`}
  >
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-mc-accent" strokeWidth={1.5} />
      <span className="font-sans text-xs font-medium uppercase tracking-label text-mc-text">
        Section Label
      </span>
    </div>
    <span className="font-mono text-xs text-mc-text-tertiary">
      {expanded ? '−' : '+'}
    </span>
  </button>

  {expanded && (
    <div className="mt-3 space-y-3">
      <div className="border border-mc-border rounded-chip p-3">
        <h4 className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mb-2">
          Sub-section Title
        </h4>
        {/* Content */}
      </div>
    </div>
  )}
</section>
```

### Section Accent Assignments

| Section Type | Accent Token | Icon Style |
|---|---|---|
| Content / Directives | `mc-warning` | Folder icon |
| Fleet / Controls | `mc-accent` | Cog icon |
| Budget / Spend | `mc-success` | Dollar icon |
| Governance / Safety | `mc-danger` | Shield icon |
| Audit / Logs | `mc-info` | Clipboard icon |

Rules:
- **No emoji anywhere** — use inline SVGs or Lucide icons
- Icons: `w-4 h-4`, stroke style, `strokeWidth={1.5}`
- Section labels: UPPERCASE, `tracking-label`
- Toggle states use `<Toggle>` primitive, not ad-hoc button styles

---

## Animation

Every animation respects `prefers-reduced-motion: reduce` — the global
media query in `globals.css` sets `animation: none` and clamps
transitions to 0.01ms when the OS preference is on. **Don't add a new
animation without verifying it degrades gracefully.**

| Pattern | Implementation |
|---|---|
| Live health pulse | `animate-mc-pulse` on the HealthDot |
| Breathing glow (active agents) | `animate-mc-breathe` |
| Communication particle | `animate-mc-particle-flow` along an SVG path |
| Interactive hover | `transition-colors duration-mc ease-mc-out` |
| Drawer slide | `300ms cubic-bezier(0.16, 1, 0.3, 1)` |

`ease-mc-out` = `cubic-bezier(0.16, 1, 0.3, 1)`. `duration-mc` = 220ms.

---

## Layout Patterns

### Two-Column with Chat (OpenClaw page)

```tsx
<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
  <div className="lg:col-span-3 space-y-6">
    {/* Content panels */}
  </div>
  <div className="lg:col-span-2">
    <ChatPanel />
  </div>
</div>
```

### Metric Strip (Home / Department headers)

```tsx
<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
  <Metric label="Active" value="12/15" trend="3 idle" accent="accent" />
  {/* … */}
</div>
```

### Card Grid (Channels, Skills)

```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
  {/* Compact panels */}
</div>
```

### List Layout

```tsx
<div className="divide-y divide-mc-border">
  {items.map(item => (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-mc-surface-hover transition-colors duration-mc">
      {/* Left: dot + name */}
      {/* Right: metadata */}
    </div>
  ))}
</div>
```

---

## Anti-Patterns (Do NOT Do)

- **No emoji in UI chrome** — use inline SVGs or Lucide icons
- **No gear icon for Settings button** — always use the text "Settings"
- **No palette modifications** — add new semantic tokens only through
  a Design review; existing tokens are stable
- **No monospace for UI labels/headings** — monospace is for data
  only (IDs, metrics, timestamps, code)
- **No filled panels** — the signature look is outlined; fills are the
  exception (glass/accent-wash variants only)
- **No custom scrollbars on new surfaces** — the global thin-gray
  scrollbar lives in `globals.css`; don't add per-component overrides
- **No horizontal scrolling** — responsive grid breakpoints only
- **No inline styles** — Tailwind classes only. Exception: runtime
  values (progress-bar widths, SVG stroke fills driven by dept
  color) via the CSS custom property equivalents (e.g.
  `style={{ background: 'var(--mc-dept-executive)' }}`).
- **No new animations without reduced-motion** — verify the media
  query in `globals.css` covers your animation name or add it there
- **No third-party UI libraries** — primitives live in
  `src/components/ui/` and are hand-built

---

## Legacy — `terminal-*`

The `terminal-*` palette still works while migration is in flight.
Don't write new components against it, and don't change its values.
The entire namespace is removed in Phase 6 once every file is migrated.

See `DESIGN-SYSTEM.md` for the full terminal → mc token mapping table.

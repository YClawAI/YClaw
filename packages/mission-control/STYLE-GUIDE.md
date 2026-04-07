# Mission Control — Complete Style Guide

> Visual design system for the YClaw Mission Control dashboard.
> Extracted from the live codebase (`packages/mission-control/`).
> All new components **must** follow these patterns exactly.

---

## Tech Stack

- **Framework:** Next.js 14 (App Router, Server Components + Client Islands)
- **Styling:** Tailwind CSS (dark mode via `class`)
- **Font:** JetBrains Mono (monospace everywhere, applied at `<body>`)
- **Data:** Server Components with 30s revalidation + SSE overlay for real-time
- **State:** React hooks + Zustand stores (e.g., `chat-store`)
- **Package:** `packages/mission-control/` in the `yclaw` monorepo

---

## Color Palette (Frozen — Do Not Modify)

Defined in `tailwind.config.ts` → `theme.extend.colors.terminal`:

| Token | Hex | Usage |
|---|---|---|
| `terminal-bg` | `#0a0a0f` | Page background |
| `terminal-surface` | `#111118` | Cards, panels, sidebar, drawers |
| `terminal-border` | `#1e1e2e` | All borders |
| `terminal-muted` | `#2a2a3a` | Hover backgrounds, active sidebar items |
| `terminal-text` | `#cdd6f4` | Primary text |
| `terminal-dim` | `#6c7086` | Secondary/muted text, timestamps, labels |
| `terminal-green` | `#a6e3a1` | Active, success, healthy, savings |
| `terminal-red` | `#f38ba8` | Error, danger, overspend, kill actions |
| `terminal-yellow` | `#f9e2af` | Warning, pending, idle <1h |
| `terminal-blue` | `#89b4fa` | Info, completed, links, edit actions |
| `terminal-purple` | `#cba6f7` | Brand accent, review status, OpenClaw |
| `terminal-cyan` | `#89dceb` | Fleet badges, fleet budget headers |
| `terminal-orange` | `#fab387` | Blocked, offline >1h |

### Department Color Assignments

| Department | Color | Rationale |
|---|---|---|
| Executive | `terminal-cyan` | Command/control, authority |
| Marketing | `terminal-orange` | Energy, warmth |
| Development | `terminal-blue` | Technical, builder |
| Operations | `terminal-green` | Health, uptime, monitoring |
| Finance | `terminal-purple` | Wealth, sophistication |
| Support | `terminal-yellow` | Attention, helpfulness |

### Tailwind Config (Complete)

```typescript
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
```

---

## Typography

All text is monospace (`font-mono` at body level).

| Context | Classes |
|---|---|
| Page title | `text-lg font-bold text-terminal-text tracking-wide` |
| Page title (accent) | `text-lg font-bold text-terminal-purple` |
| Page subtitle | `text-xs text-terminal-dim` |
| Section headers | `text-xs font-bold uppercase tracking-widest text-terminal-dim` |
| Section title (bold) | `text-sm font-bold text-terminal-text` |
| Stat values (large) | `text-2xl font-bold text-terminal-text font-mono` |
| Stat values (medium) | `text-lg font-bold text-terminal-{color}` |
| Primary body text | `text-xs text-terminal-text` |
| Secondary body text | `text-xs text-terminal-dim` |
| Tiny annotations | `text-[10px] text-terminal-dim` |
| Drawer section labels | `text-xs font-bold uppercase tracking-widest text-terminal-text` |
| Drawer sub-headers | `text-[10px] font-bold uppercase tracking-wider text-terminal-dim` |
| Drawer sub-sub-headers | `text-[10px] font-bold uppercase tracking-wider text-terminal-dim/60` |

---

## Spacing

| Context | Value |
|---|---|
| Main content padding | `p-6` |
| Section gaps | `mb-6` (standard), `mb-8` (between department groups) |
| Card padding | `p-4` (standard), `p-5` (hero cards) |
| Grid gaps | `gap-3` (cards), `gap-4` (stats), `gap-6` (major sections) |
| Drawer internal padding | `p-6` |
| Drawer section gaps | `mb-6` |

---

## Component Recipes

### Card

```
bg-terminal-surface border border-terminal-border rounded p-4
```

Accent-bordered cards (e.g., OpenClaw):
```
bg-terminal-surface border border-terminal-purple/30 rounded p-5
```

### Stat Block (inside cards)

```
p-3 bg-terminal-bg rounded text-center
```
Inner: large value + tiny label underneath

### Status Badge

```tsx
// Component: src/components/status-badge.tsx
<StatusBadge status="active" />  // green
<StatusBadge status="pending" /> // yellow
<StatusBadge status="failed" />  // red
<StatusBadge status="review" />  // purple
<StatusBadge status="blocked" /> // orange
<StatusBadge status="idle" />    // muted
```

Pattern:
```
inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border
bg-{color}/10 text-{color} border-{color}/30
```

Status map:
| Status | Color |
|---|---|
| active, running | green |
| completed, merged | blue |
| failed, error | red |
| pending, queued | yellow |
| review | purple |
| blocked | orange |
| idle | muted/dim |

### Health Dot

```tsx
// Component: src/components/health-dot.tsx
<HealthDot healthy={true} />
<HealthDot healthy={false} label="Disconnected" />
```

Pattern:
```
inline-block w-2 h-2 rounded-full bg-{color} shadow-[0_0_6px_{hex}]
```
- Healthy: `bg-terminal-green shadow-[0_0_6px_#a6e3a1]`
- Unhealthy: `bg-terminal-red shadow-[0_0_6px_#f38ba8]`

### Button — Ghost (Settings trigger, default actions)

```
px-3 py-1.5 text-xs font-mono border border-terminal-border rounded
text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface transition-colors
```

**Label: always text, never emoji.** Example: "Settings", not "⚙️"

### Button — Primary (colored actions)

```
px-3 py-1.5 text-xs font-mono rounded border transition-colors
bg-{color}/20 text-{color} border-{color}/40 hover:bg-{color}/30
```

### Button — Danger

```
px-3 py-1.5 text-xs font-mono rounded border transition-colors
bg-terminal-red/20 text-terminal-red border-terminal-red/40 hover:bg-terminal-red/30
```

### Button — Toggle (on/off state)

```tsx
// Off state:
border-terminal-border text-terminal-dim hover:border-terminal-muted

// On state:
border-terminal-red/50 bg-terminal-red/10 text-terminal-red
// or green for positive toggles:
border-terminal-green/50 bg-terminal-green/10 text-terminal-green
```

### Input

```
bg-terminal-bg border border-terminal-border rounded px-3 py-1.5
text-xs text-terminal-text placeholder-terminal-dim font-mono
focus:outline-none focus:border-terminal-purple
```

### Progress Bar

```
outer: w-full h-2 bg-terminal-muted/30 rounded-full overflow-hidden
inner: h-full rounded-full transition-all duration-500
```

Color thresholds:
- `>90%` → `#ef4444` (red)
- `>warn%` → `#f59e0b` (amber)
- Default → `#22c55e` (green)

### List Items

```
divide-y divide-terminal-border
(each): px-4 py-2.5 hover:bg-terminal-muted/30 transition-colors
```

### Modal Overlay

```
fixed inset-0 z-50 bg-black/60 backdrop-blur-sm
```

### Modal Panel

```
bg-terminal-surface border border-terminal-border rounded-lg p-6 shadow-2xl
```

---

## Page Header Pattern

Every page uses the same header structure:

```tsx
<div className="flex items-center justify-between mb-6">
  <h1 className="text-lg font-bold text-terminal-text tracking-wide">Page Title</h1>
  <div className="flex items-center gap-2">
    <button className="px-3 py-1.5 text-xs font-mono border border-terminal-border rounded hover:bg-terminal-surface transition-colors text-terminal-dim hover:text-terminal-text">
      Settings
    </button>
  </div>
</div>
```

For accent-colored titles (OpenClaw):
```tsx
<h1 className="text-lg font-bold text-terminal-purple">OpenClaw</h1>
```

---

## Settings Drawer Pattern

### Container (`SettingsDrawer` component)

```tsx
// src/components/settings-drawer.tsx
<SettingsDrawer open={open} onClose={() => setOpen(false)} title="Page Settings">
  {/* Accordion sections go here */}
</SettingsDrawer>
```

Behavior:
- **Position:** Right-side overlay, `max-w-md`, z-50
- **Mobile:** Bottom sheet with `max-h-[80vh]` and rounded top
- **Background:** `bg-terminal-surface`, left border
- **Backdrop:** `bg-black/40`, click-to-close
- **Escape key** closes drawer
- **Body scroll** locked when open
- **Sticky header:** Title (text-sm font-bold) + × close button

### Trigger Button

Always a text-labeled ghost button. **Never use emoji.**

```tsx
<button
  onClick={() => setOpen(true)}
  className="px-3 py-1.5 text-xs font-mono text-terminal-text border border-terminal-border rounded hover:border-terminal-muted hover:bg-terminal-muted/30 transition-colors"
>
  Settings
</button>
```

### Accordion Sections (inside drawer)

Each section follows this exact structure:

```tsx
<section className="mb-6">
  {/* Section header — collapsible */}
  <button
    onClick={() => toggleSection('sectionKey')}
    className={`w-full flex items-center justify-between px-3 py-2.5 rounded border transition-colors ${
      expanded
        ? 'border-terminal-{accent}/50 bg-terminal-{accent}/5'
        : 'border-terminal-border hover:border-terminal-muted'
    }`}
  >
    <div className="flex items-center gap-2">
      <SvgIcon className="w-4 h-4 text-terminal-{accent}" />
      <span className="text-xs font-bold uppercase tracking-widest text-terminal-text">
        Section Label
      </span>
    </div>
    <span className="text-terminal-dim text-xs">
      {expanded ? '\u2212' : '+'}
    </span>
  </button>

  {/* Section content — shown when expanded */}
  {expanded && (
    <div className="mt-3 space-y-3">
      {/* Sub-cards */}
      <div className="bg-terminal-muted/20 border border-terminal-border rounded p-3">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-terminal-dim mb-2">
          Sub-section Title
        </h4>
        {/* Content: text, inputs, toggles, lists */}
      </div>
    </div>
  )}
</section>
```

### Section Color Assignments (from existing pages)

| Section Type | Accent Color | Icon Style |
|---|---|---|
| Content/Directives | `terminal-orange` | Folder SVG |
| Fleet/Controls | `terminal-cyan` | Cog SVG |
| Budget/Spend | `terminal-green` | Dollar SVG |
| Governance/Safety | `terminal-red` | Shield SVG |
| Audit/Logs | `terminal-blue` | Clipboard SVG |

**Rules:**
- **No emoji anywhere** in the drawer — use inline SVGs
- SVGs: `w-4 h-4`, stroke icons (Heroicons style), `strokeWidth={1.5}`
- Section labels: UPPERCASE, tracking-widest
- Sub-section labels: `text-[10px]` UPPERCASE
- All interactive controls use `text-xs font-mono`
- Toggle states use colored borders + `/10` backgrounds

---

## Animation

| Pattern | Implementation |
|---|---|
| Live connection | `animate-pulse` on green HealthDot |
| Streaming cursor | `<span className="animate-pulse">\|</span>` |
| Flash on update | `scale-105` + color change with `transition-all duration-300` |
| Interactive elements | `transition-colors` on all buttons/links |
| Stopped/paused | `animate-pulse` on red badges |

---

## Layout Patterns

### Two-Column with Chat (OpenClaw page)

```tsx
<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
  <div className="lg:col-span-3 space-y-6">
    {/* Content cards */}
  </div>
  <div className="lg:col-span-2">
    <ChatPanel />
  </div>
</div>
```

### Stat Grid (Mission Control home)

```tsx
<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
  <StatCard label="Active Agents" value="12/15" sub="3 idle" />
</div>
```

### Card Grid (Channels, Skills)

```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
  {/* Compact cards */}
</div>
```

### List Layout (Agents, Channels detail)

```tsx
<div className="space-y-2">
  {items.map(item => (
    <div className="flex items-center justify-between p-2 bg-terminal-bg rounded">
      {/* Left: dot + name */}
      {/* Right: metadata */}
    </div>
  ))}
</div>
```

---

## Existing Reusable Components

Import from `@/components/`:

| Component | Usage |
|---|---|
| `HealthDot` | Green/red status dot with optional label |
| `StatusBadge` | Colored text badge (active/pending/failed/etc.) |
| `ChatPanel` | Embedded OpenClaw chat (used in chat drawer + OpenClaw page) |
| `SettingsDrawer` | Right-side overlay drawer container |
| `RefreshTrigger` | Auto-refresh for server component pages |
| `FleetKillSwitch` | Emergency pause all agents |
| `BudgetOverview` | Budget table with per-agent rows |
| `BudgetEditor` | Per-agent budget config |
| `BurnVelocity` | Spend rate visualization |

---

## Anti-Patterns (Do NOT Do)

- **No emoji in UI chrome** — use SVG icons (Heroicons style) or text labels
- **No gear icon for Settings** — always use the text "Settings"
- **No color modifications** — the terminal-* palette is frozen
- **No sans-serif fonts** — everything is monospace
- **No custom scrollbars** — use browser defaults
- **No horizontal scrolling** — responsive grid breakpoints only
- **No inline styles** — Tailwind classes only (exception: dynamic widths/colors for progress bars)
- **No third-party UI libraries** — all components are hand-built with Tailwind

# Mission Control — Design System Reference

> Visual design system for the YClaw Mission Control dashboard.
> All new components **must** follow these patterns exactly.
> The terminal-\* palette in `tailwind.config.ts` is **frozen** — do not modify.

---

## Color Tokens

Defined in `tailwind.config.ts` under `theme.extend.colors.terminal`:

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
| `terminal-purple` | `#cba6f7` | Brand accent, review status, OpenClaw chat |
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

---

## Typography

All text is monospace. `font-mono` (JetBrains Mono) is applied at the `<body>` level.

| Context | Classes |
|---|---|
| Section headers | `text-xs font-bold uppercase tracking-widest text-terminal-dim` |
| Stat values | `text-2xl font-bold text-terminal-text font-mono` |
| Primary body text | `text-xs text-terminal-text` |
| Secondary body text | `text-xs text-terminal-dim` |
| Tiny annotations | `text-[10px] text-terminal-dim` |

---

## Component Recipes

### Card
```
bg-terminal-surface border border-terminal-border rounded p-4
```

### Status Badge
```
inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border
bg-{color}/10 text-{color} border-{color}/30
```

### Health Dot
```
inline-block w-2 h-2 rounded-full bg-{color} shadow-[0_0_6px_{hex}]
```

### Button (Primary)
```
px-3 py-1.5 text-xs font-mono rounded border transition-colors
bg-{color}/20 text-{color} border-{color}/40 hover:bg-{color}/30
```

### Button (Ghost)
```
px-3 py-1.5 text-xs font-mono rounded border border-terminal-border
text-terminal-dim hover:text-terminal-text
```

### Input
```
bg-terminal-bg border border-terminal-border rounded px-3 py-1.5
text-xs text-terminal-text placeholder-terminal-dim
focus:outline-none focus:border-terminal-purple
```

### Modal Overlay
```
fixed inset-0 z-50 bg-black/60 backdrop-blur-sm
```

### Modal Panel
```
bg-terminal-surface border border-terminal-border rounded-lg p-6 shadow-2xl
```

### Table
```
border border-terminal-border rounded overflow-hidden
(inner) text-sm font-mono
```

### Progress Bar
```
outer: bg-terminal-border rounded-full h-2
inner: h-2 rounded-full bg-{color}
```

### List Items
```
divide-y divide-terminal-border
(each): px-4 py-2.5 hover:bg-terminal-muted/30 transition-colors
```

---

## Spacing

| Context | Value |
|---|---|
| Main content padding | `p-6` |
| Section gaps | `mb-6` (standard), `mb-8` (between department groups) |
| Card padding | `p-4` (standard), `p-5` (hero cards) |
| Grid gaps | `gap-3` (cards), `gap-4` (stats) |

---

## Animation

| Pattern | Implementation |
|---|---|
| Live connection indicator | `animate-pulse` on green dot |
| Streaming cursor | `<span className="animate-pulse">\|</span>` |
| Flash on update | Conditional `scale-105` + color change with `transition-all duration-300` |
| Interactive elements | `transition-colors` |
| Stopped/paused states | `animate-pulse` on red badges |

---

## Existing Components (Reuse, Don't Rewrite)

These components are kept as-is and imported into new pages:

- `ChatPanel` — reused inside chat drawer
- `StatusBadge` — status displays everywhere
- `BurnVelocity` — finance dept, home page
- `SpendFlow` — finance dept
- `BudgetEditor` — agent detail views
- `BudgetModeToggle` — settings
- `GlobalBudgetCard` — settings
- `BudgetOverview` — settings/finance
- `WhatIfSimulator` — finance dept
- `TokenMap` — finance dept
- `FleetKillSwitch` — status header logic
- `RefreshTrigger` — server-component pages
- `SystemBadge` — agent cards

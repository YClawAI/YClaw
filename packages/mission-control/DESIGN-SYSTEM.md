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
| Audit timeline new-event highlight | `animate-highlight` — defined in `globals.css`; fades from `rgba(90,200,250,0.15)` (`mc-accent` / `#5AC8FA`) to transparent over 2 s (`ease-out`). Applied to newly-arrived audit rows. |

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

---

## SpaceX Token Migration Notes (mc-* palette)

> These notes apply to files migrated to the `mc-*` design token namespace (PR #126).
> The `terminal-*` palette above remains frozen for all un-migrated files.
> Migration rule: a file uses `terminal-*` **or** `mc-*`, never both — whole files flip in one commit.

### mc-blocked vs mc-dept-marketing — Amber Collision

Both `mc-blocked` and `mc-dept-marketing` resolve to `#FF9F0A` (iOS system amber).

| Token | Hex | Semantic Role |
|---|---|---|
| `mc-blocked` | `#FF9F0A` | Agent/task blocked status indicator |
| `mc-dept-marketing` | `#FF9F0A` | Marketing department accent color |

**Rule:** These tokens must **not** be substituted for each other. Always use the semantically correct token for the context — `mc-blocked` for status indicators, `mc-dept-marketing` for department theming. The shared value is intentional (Marketing's warmth palette aligns with the warning/blocked hue) but the tokens carry different semantic contracts. Mixing them will break status-color logic if either token value diverges in a future palette revision.

---

### EVENT_CATEGORY_COLORS — Canvas Event Palette

Defined in `src/components/hive/hive-types.ts` as the canonical color mapping for hive particle events. **This file is read-only for palette edits** — to change a color, update `EVENT_CATEGORY_COLORS` in `hive-types.ts` directly; do not override it elsewhere.

These are raw hex values used directly by the canvas renderer (`CanvasRenderingContext2D`) and are not Tailwind tokens. Canvas APIs require hex/rgba strings; the `mc-*` CSS custom properties are not available in canvas draw calls.

| Category | Hex | Semantic Group |
|---|---|---|
| `pr` | `#a855f7` | Inter-agent — purple (pull request) |
| `content` | `#22c55e` | Inter-agent — green (content push) |
| `task` | `#f59e0b` | Inter-agent — amber (task assignment) |
| `alert` | `#ef4444` | Inter-agent — red (alert / error) |
| `directive` | `#fbbf24` | Inter-agent — yellow (directive) |
| `heartbeat` | `#6b7280` | Inter-agent — gray (heartbeat ping) |
| `github_outbound` | `#8b5cf6` | External outbound — violet |
| `twitter_outbound` | `#1d9bf0` | External outbound — Twitter blue |
| `slack_outbound` | `#e01e5a` | External outbound — Slack red |
| `web_outbound` | `#6b7280` | External outbound — gray |
| `figma_outbound` | `#a259ff` | External outbound — Figma purple |
| `api_outbound` | `#94a3b8` | External outbound — slate |
| `llm_call` | `#f59e0b` | External outbound — amber |
| `github_inbound` | `#a78bfa` | External inbound — lighter violet |
| `twitter_inbound` | `#38bdf8` | External inbound — sky blue |
| `slack_inbound` | `#f472b6` | External inbound — pink |
| `web_inbound` | `#9ca3af` | External inbound — light gray |
| `openclaw_trigger` | `#ef4444` | OpenClaw — red |
| `openclaw_directive` | `#f97316` | OpenClaw — orange |
| `openclaw_response` | `#fb923c` | OpenClaw — light orange |

**Palette intent:** Outbound events use cooler, dimmer hues; inbound events use warmer, brighter variants of the same family. OpenClaw interactions use the red/orange family to signal elevated authority. Inter-agent events span the full visible spectrum by semantic weight.

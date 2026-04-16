# Designer Skills

Designer is the design system enforcer in the Development department. It reviews frontend PRs for visual consistency, component fidelity, accessibility, and brand alignment. Designer shares the design system source of truth with Forge (Marketing) and coordinates through executive directives to keep creative output and frontend implementation in sync.

## Skills

### design-system

The authoritative design token reference for the YClaw UI. Contains code-ready values for direct use in implementation:

- **CSS Custom Properties** -- full `:root` block with colors (Ember Gallery palette), gradients, typography, spacing, radii, shadows, animation timing, and z-index layers.
- **Tailwind Configuration** -- `tailwind.config.js` extension mapping YClaw tokens to Tailwind utilities, including custom keyframes (`gradient-shift`, `glow-breathe`, `pulse-glow`, `heat-wave`, `float-up`, `flicker`).
- **Grain Overlay** -- SVG-based noise texture applied via `body::after`.
- **Typography Scale** -- 14 roles from Wordmark (Inter Thin, gradient fill) to Button Ghost, with font, weight, size, line-height, color, and extras.
- **Component Tokens** -- CSS for cards, buttons (warm + ghost), stat pills, and nav bar.
- **Icon Guidelines** -- monoline style, 1-1.5px stroke, Lucide React recommended.
- **Burning Eye SVG** -- full mark (280px) and simplified (80px favicon) SVG code.
- **Responsive Breakpoints** -- mobile-first at 640/768/1024/1280px.
- **Dark-on-Light Inverse Mode** -- alternate token values for light backgrounds.

**File:** `design-system/SKILL.md`

### component-specs

Detailed specifications for every UI component in the YClaw frontend. Each component entry defines layout, styling tokens, hover behavior, and animation rules:

- **Shared Patterns** -- hover warmup (400ms border + glow), skeleton loading (no spinners), page transitions (fade only, staggered `float-up`).
- **Navigation** -- desktop (fixed, backdrop blur) and mobile (full-screen overlay), wallet connection states.
- **Burning Eye Component** -- React props interface (`size`, `animate`, `variant`), size-specific behavior (xs through hero at 280px), animation rules (iris pulse, pupil glow, outer glow breathing).
- **Token Card** -- grid layout with icon, price (JetBrains Mono), 24h change (molten/pulse), hover lift.
- **Price Chart** -- gradient line + fill, timeframe tabs (1H-ALL), crosshair tooltip.
- **Stake/Trade Panel** -- tabs (Stake, Trade, Claim), form layouts, slippage selector.
- **Activity Feed** -- row layout with type-colored icons, description format, relative timestamps.
- **Leaderboard Table** -- rank styling (top 3 gradient), "You" row highlight.
- **Stats Bar** -- horizontal metrics row with gradient values and UI labels.
- **Notification Toast** -- slide-in from top-right, auto-dismiss 5s, hover pause.
- **Portfolio Summary Cards** -- 2x2 grid, "Unclaimed Rewards" card gets blaze border glow.
- **Form Inputs** -- text/number input, MAX button, slippage pills.
- **Modals** -- overlay (80% obsidian + blur), modal box (480px max), fade + translateY animation.

**File:** `component-specs/SKILL.md`

### review-boundary

Defines when Designer reviews vs builds autonomously. Covers the three modes: **Review Only** (frontend PRs from AO/Mechanic — check tokens, accessibility, flag-don't-fix), **Build Autonomously** (new components, token updates, Figma-to-code when directed), and **Escalate** (logic changes disguised as design, API/data-model changes, breaking component APIs). Includes coordination rules with Forge and Architect.

**File:** `review-boundary/SKILL.md`

## Triggers

| Event | Task |
|---|---|
| `builder:pr_ready` | `design_review` |
| `forge:asset_ready` | `integrate_design_update` |
| `strategist:designer_directive` | `design_directive` |
| Cron (daily) | `daily_standup` |

## Integration

- Reviews frontend PRs from **Builder** for design system compliance.
- Receives completed assets from **Forge** and integrates design updates.
- Shares the design system and component specs with **Forge** (both load the same source files).
- Has Figma API access (`figma:get_file`, `figma:get_components`, `figma:get_styles`, etc.) for design-to-code verification.
- Publishes `designer:design_review` events.

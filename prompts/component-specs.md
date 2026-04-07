<!-- CUSTOMIZE FOR YOUR ORGANIZATION — See examples/gaze-protocol/ for reference -->

# Component Specifications

> How each component should look, behave, and animate. Reference this before building any component.

---

## Shared Patterns

### Hover Behavior
All interactive elements warm up on hover:
- Border: transitions from `--brand-border` to `--brand-border-hover` over 400ms
- Glow: faint box-shadow appears (`--shadow-glow-lg`)
- **Never snap.** Always transition.
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)`

### Loading States
- Skeleton screens use `--brand-surface-dark` with a subtle pulse animation
- Never show spinners. Use skeleton shapes that match the final content.
- Gradient shimmer moves left-to-right, using the accent gradient at 5% opacity

### Transitions Between Pages
- Content fades in (`float-up` animation, 1s duration, staggered by 100ms per element)
- **Never slide.** Fade only.
- Sections appear in order: label → title → content → interactive elements

---

## Navigation

### Desktop Nav
```
[[Your Logo]] [[YOUR_ORG] wordmark]     [Nav Item 1] [Nav Item 2] [Nav Item 3] [Docs]     [Launch App]
```

- Fixed to top, backdrop blur, semi-transparent dark background
- Logo icon: Simplified [Your Logo] SVG (20px)
- Wordmark: Inter Thin, gradient fill, letter-spacing 8px
- Links: Inter 300, 12px, muted color, hover → accent
- CTA button: Ghost style (border), hover fills with accent
- Height: ~64px with 18px padding

### Mobile Nav
- Hamburger icon (three thin lines, muted)
- Opens full-screen overlay with dark background
- Links centered, larger (18px), stacked vertically
- Logo icon centered at top of overlay

### Wallet Connection
- "Connect Wallet" button in nav (ghost style)
- Connected state: Show truncated address in JetBrains Mono + small wallet icon
- Dropdown on click: address, balance, disconnect

---

## [Your Logo] Component

Reusable SVG component with configurable size and animation.

### Props
```typescript
interface LogoProps {
  size: 'xs' | 'sm' | 'md' | 'lg' | 'hero';  // 16, 24, 48, 80, 280px
  animate?: boolean;          // default true for hero, false for others
  variant?: 'full' | 'simple' | 'mono';  // default 'full'
  className?: string;
}
```

### Size Behavior
- **xs (16px):** Footer, inline references. Simple variant, no glow.
- **sm (24px):** Nav, extension header. Simple variant, subtle glow.
- **md (48px):** Section headers, cards. Full variant, subtle animation.
- **lg (80px):** Feature sections. Full variant, full animation.
- **hero (280px):** Landing page hero. Full variant, all animations.

### Animation Rules
- The logo shape never moves or rotates
- Inner elements can pulse (customize scale and timing)
- Glow effects can breathe (opacity and scale oscillation)
- Static decorative elements remain fixed

---

## Data Card

Used in the Explore/listing page grid. Customize fields for your domain.

### Layout
```
[Icon]  [Name]          [Primary Metric]    [Change Indicator]
        [Subtitle]      [Secondary Metric]  [Tertiary Metric]
```

### Icon
- 48px, rounded-lg (14px radius)
- Background: subtle gradient (accent at 10% opacity)
- Border: accent at 13% opacity
- Content: First letter of item name, gradient text

### Data Display
- Primary metric: JetBrains Mono, 20px, weight 300, white
- Change indicator: JetBrains Mono, 11px, positive color or negative color
- Secondary metrics: JetBrains Mono, 11px, muted color

### Hover
- Border warms to `--brand-border-hover`
- Faint card glow appears
- Slight translateY(-2px)

---

## Time-Series Chart

### Visual Style
- Line: 1.5px stroke, gradient (accent → secondary)
- Fill: Same gradient, 10% opacity at top fading to 0% at bottom
- Background: `--brand-bg-elevated` with `--brand-border`
- Border radius: `--radius-md`

### Timeframe Tabs
- Options: 1H, 4H, 1D, 1W, 1M, ALL (customize for your domain)
- Active tab: accent text
- Inactive: ghost text
- Tab style: no background, just text color change

### Crosshair / Tooltip
- Vertical line: 1px, ghost color
- Tooltip: surface-dark background, border, shows value + timestamp
- Value in JetBrains Mono with gradient fill

---

## Action Panel

Right sidebar or modal for primary user interactions. Customize tabs and forms for your domain.

### Tabs
```
[Action 1]  [Action 2]  [Action 3]
```
- Active tab: accent text + bottom border in gradient
- Inactive: muted text

### Primary Action Form
```
[Amount Input]          [MAX]
[Balance: 12,400 units]

[Estimated Result: 0.47 units]

[Submit Action]  (primary button)
```

### Secondary Action Form (toggle variant)
```
[Option A] [Option B]  (toggle, active has gradient background)

Input:   [Amount Input] [Unit A]
Output:  [Estimated]    [Unit B]

Settings: [0.5%] [1%] [Custom]

[Confirm]  (primary button)
```

### Status Section
```
Pending Items:     847.23
Available:         12.4 units
Estimated Value:   $0.35

[Claim / Collect]  (primary button)
```

---

## Activity Feed

Used on token pages and platform-wide.

### Row Layout
```
[Type Icon]  [Description]                    [Amount]     [Time]
```

### Type Icons
- Small circles (8px) or small icons (16px) with type-specific color:
  - Positive action: accent
  - Negative action: danger
  - Neutral action: secondary
  - Inactive: muted
  - Highlight: accent with glow

### Description Format
Customize descriptions for your domain actions, e.g.:
- "[user] performed [action] with [amount] [unit]"
- "[user] completed [action] — [result]"

### Time Format
- Recent: "2m ago", "1h ago"
- Older: "Feb 11" or "Feb 11, 2026"

---

## Ranked Table

### Header
- JetBrains Mono, 9px, ghost color, uppercase, letter-spacing 2px

### Rows
- Rank: JetBrains Mono, bold. Top 3 get gradient text.
- Name: Inter 400, white. Truncate with ellipsis.
- Primary metric: JetBrains Mono 500, gradient fill for top 10, muted for others.
- Secondary metric: JetBrains Mono 400, muted.

### Current User Row
- Highlighted with faint accent border on left (2px)
- Slightly different background (`--brand-surface-dark`)
- "You" badge next to name

---

## Stats Bar

Horizontal row of key metrics (used on landing page and dashboard).

### Layout
```
[$4.2M]              [12,847]             [347]              [9]
Total Value Staked   Active Watchers      Creator Tokens     Platforms
```

- Value: JetBrains Mono, 24-28px, weight 600, gradient fill
- Label: 10-11px, ghost color, uppercase, letter-spacing 1px
- Separated by 1px vertical borders (`--brand-border`)
- Each cell centered, equal width

---

## Notification Toast

### Layout
```
[[Your Logo]]  [[YOUR_ORG]]                           [2m ago]
[Title — bold, white]
[Description — light, muted]
[Action Button (optional)]
```

### Behavior
- Slides in from top-right
- Auto-dismisses after 5 seconds
- Hover pauses the dismiss timer
- Close button (X) in top right, ghost color
- Background: surface-dark with border
- Max width: 380px

---

## Portfolio Summary Cards

### Card Grid (2x2)
```
[Total Value]           [Total Staked]
 $12,847.23              45,200 tokens

[Unclaimed Rewards]     [Lifetime Earned]
 847 options             $2,341.67
```

### Card Style
- Background: `--brand-bg-card`
- Border: `--brand-border`
- Radius: `--radius-lg`
- Value: JetBrains Mono, 20-24px, white or gradient
- Label: 11px, ghost color, uppercase
- The highest-priority card should have a subtle accent border glow to draw attention

---

## Form Inputs

### Text/Number Input
- Background: `--brand-bg-elevated`
- Border: `--brand-border`
- Radius: `--radius-md`
- Text: Inter 300, 16px, white
- Placeholder: `--brand-ghost`
- Focus: border becomes `--brand-accent` at 30% opacity
- Height: 48px
- Padding: 14px 16px

### MAX Button (inside input)
- Position: absolute right
- JetBrains Mono, 10px, uppercase, accent color
- Hover: brighter accent

### Slippage Selector
- Row of small pills: [0.5%] [1%] [2%] [Custom]
- Active: surface-dark background + accent border
- Inactive: ghost border, ghost text

---

## Modals

### Overlay
- Background: dark at 80% opacity + backdrop-blur(12px)

### Modal Box
- Background: `--brand-bg-elevated`
- Border: `--brand-border`
- Radius: `--radius-xl`
- Max width: 480px
- Padding: 32px
- Close button: top-right, ghost color, 24px

### Animation
- Overlay fades in (200ms)
- Modal fades in + translateY from 20px (300ms, eased)
- Close: reverse, slightly faster (200ms)

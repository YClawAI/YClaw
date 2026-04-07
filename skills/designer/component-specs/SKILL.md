# YCLAW — Component Specifications

> How each component should look, behave, and animate. Reference this before building any component.

---

## Shared Patterns

### Hover Behavior
All interactive elements warm up on hover:
- Border: transitions from `--yclaw-border` to `--yclaw-border-hover` over 400ms
- Glow: faint box-shadow appears (`--shadow-glow-lg`)
- **Never snap.** Always transition.
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)`

### Loading States
- Skeleton screens use `--yclaw-ember-dark` with a subtle pulse animation
- Never show spinners. Use skeleton shapes that match the final content.
- Gradient shimmer moves left-to-right, using the blaze-molten gradient at 5% opacity

### Transitions Between Pages
- Content fades in (`float-up` animation, 1s duration, staggered by 100ms per element)
- **Never slide.** Fade only.
- Sections appear in order: label → title → content → interactive elements

---

## Navigation

### Desktop Nav
```
[Eye Icon] [YCLAW wordmark]     [Protocol] [Creators] [Leaderboard] [Docs]     [Launch App]
```

- Fixed to top, backdrop blur, semi-transparent obsidian background
- Eye icon: Simplified Burning Eye SVG (20px)
- Wordmark: Inter Thin, gradient fill, letter-spacing 8px
- Links: Inter 300, 12px, deep-warm color, hover → blaze
- CTA button: Ghost style (border), hover fills with blaze
- Height: ~64px with 18px padding

### Mobile Nav
- Hamburger icon (three thin lines, warm-gray)
- Opens full-screen overlay with obsidian background
- Links centered, larger (18px), stacked vertically
- Eye icon centered at top of overlay

### Wallet Connection
- "Connect Wallet" button in nav (ghost style)
- Connected state: Show truncated address in JetBrains Mono + small wallet icon
- Dropdown on click: address, balance, disconnect

---

## The Burning Eye Component

Reusable SVG component with configurable size and animation.

### Props
```typescript
interface BurningEyeProps {
  size: 'xs' | 'sm' | 'md' | 'lg' | 'hero';  // 16, 24, 48, 80, 280px
  animate?: boolean;          // default true for hero, false for others
  variant?: 'full' | 'simple' | 'mono';  // default 'full'
  className?: string;
}
```

### Size Behavior
- **xs (16px):** Footer, inline references. Simple variant, no glow.
- **sm (24px):** Nav, extension header. Simple variant, subtle glow.
- **md (48px):** Section headers, cards. Full variant, breathing iris.
- **lg (80px):** Feature sections. Full variant, full animation.
- **hero (280px):** Landing page hero. Full variant, all animations including outer glow, iris pulse, pupil breathing, light refraction dots.

### Animation Rules
- The eye SHAPE never moves or rotates
- The iris ring can pulse (scale 28→30 over 4s)
- The pupil can glow (drop-shadow oscillates over 3s)
- The outer glow can breathe (opacity 0.12→0.25, scale 1→1.06 over 6s)
- Light refraction dots are static

---

## Token Card

Used in the Explore page grid.

### Layout
```
[Token Icon]  [Name]          [$Price]    [24h Change]
              [Ticker]        [mCap]      [Staked]
```

### Token Icon
- 48px, rounded-lg (14px radius)
- Background: subtle gradient (`blaze` at 10% opacity)
- Border: `blaze` at 13% opacity
- Content: First letter of token name, gradient text

### Data Display
- Price: JetBrains Mono, 20px, weight 300, white
- 24h change: JetBrains Mono, 11px, molten (positive) or pulse (negative)
- mCap: JetBrains Mono, 11px, deep-warm
- Staked: JetBrains Mono, 11px, deep-warm

### Hover
- Border warms to `--yclaw-border-hover`
- Faint card glow appears
- Slight translateY(-2px)

---

## Price Chart

### Visual Style
- Line: 1.5px stroke, gradient (blaze → molten)
- Fill: Same gradient, 10% opacity at top fading to 0% at bottom
- Background: `--yclaw-bg-elevated` with `--yclaw-border`
- Border radius: `--radius-md`

### Timeframe Tabs
- Options: 1H, 4H, 1D, 1W, 1M, ALL
- Active tab: blaze text
- Inactive: ghost text
- Tab style: no background, just text color change

### Crosshair / Tooltip
- Vertical line: 1px, ghost color
- Tooltip: ember-dark background, border, shows price + timestamp
- Price in JetBrains Mono with gradient fill

---

## Stake / Trade Panel

Right sidebar or modal for token interactions.

### Tabs
```
[Stake]  [Trade]  [Claim]
```
- Active tab: blaze text + bottom border in gradient
- Inactive: deep-warm text

### Stake Form
```
[Amount Input]          [MAX]
[Balance: 12,400 $KRAB]

[Estimated Rewards/Day: 0.47 $KRAB]

[Stake Now]  (primary button)
```

### Trade Form (Buy/Sell toggle)
```
[Buy] [Sell]  (toggle, active has gradient background)

Pay:    [Amount Input] [USDC]
Receive: [Estimated]    [$KRAB]

Slippage: [0.5%] [1%] [Custom]

[Buy $KRAB]  (primary button)
```

### Claim Section
```
Accrued Options:    847.23
Claimable Rewards:  12.4 $KRAB
Estimated Value:    $0.35

[Claim Rewards]  (primary button)
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
  - Buy: blaze
  - Sell: pulse
  - Deposit/stake: molten
  - Withdraw: warm-gray
  - Claim: blaze
  - Period close: blaze with glow

### Description Format
- Buy: "[address] bought [amount] $[SYMBOL]"
- Sell: "[address] sold [amount] $[SYMBOL]"
- Stake: "[address] staked [amount] $[SYMBOL]"
- Claim: "[address] claimed [amount] $[SYMBOL] rewards"

### Time Format
- Recent: "2m ago", "1h ago"
- Older: "Feb 11" or "Feb 11, 2026"

---

## Leaderboard Table

### Header
- JetBrains Mono, 9px, ghost color, uppercase, letter-spacing 2px

### Rows
- Rank: JetBrains Mono, bold. Top 3 get gradient text.
- Username: Inter 400, white. Truncate with ellipsis.
- Score: JetBrains Mono 500, gradient fill for top 10, warm-gray for others.
- Minutes: JetBrains Mono 400, deep-warm.

### Your Row
- Highlighted with faint blaze border on left (2px)
- Slightly different background (`--yclaw-ember-dark`)
- "You" badge next to username

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
- Separated by 1px vertical borders (`--yclaw-border`)
- Each cell centered, equal width

---

## Notification Toast

### Layout
```
[Eye Icon]  [YCLAW]                           [2m ago]
[Title — bold, white]
[Description — light, warm-gray]
[Action Button (optional)]
```

### Behavior
- Slides in from top-right
- Auto-dismisses after 5 seconds
- Hover pauses the dismiss timer
- Close button (X) in top right, ghost color
- Background: ember-dark with border
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
- Background: `--yclaw-bg-card`
- Border: `--yclaw-border`
- Radius: `--radius-lg`
- Value: JetBrains Mono, 20-24px, white or gradient
- Label: 11px, ghost color, uppercase
- The "Unclaimed Rewards" card should have a subtle blaze border glow to draw attention

---

## Form Inputs

### Text/Number Input
- Background: `--yclaw-bg-elevated`
- Border: `--yclaw-border`
- Radius: `--radius-md`
- Text: Inter 300, 16px, white
- Placeholder: `--yclaw-ghost`
- Focus: border becomes `--yclaw-blaze` at 30% opacity
- Height: 48px
- Padding: 14px 16px

### MAX Button (inside input)
- Position: absolute right
- JetBrains Mono, 10px, uppercase, blaze color
- Hover: brighter blaze

### Slippage Selector
- Row of small pills: [0.5%] [1%] [2%] [Custom]
- Active: ember-dark background + blaze border
- Inactive: ghost border, ghost text

---

## Modals

### Overlay
- Background: obsidian at 80% opacity + backdrop-blur(12px)

### Modal Box
- Background: `--yclaw-bg-elevated`
- Border: `--yclaw-border`
- Radius: `--radius-xl`
- Max width: 480px
- Padding: 32px
- Close button: top-right, ghost color, 24px

### Animation
- Overlay fades in (200ms)
- Modal fades in + translateY from 20px (300ms, eased)
- Close: reverse, slightly faster (200ms)

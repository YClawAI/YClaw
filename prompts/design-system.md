# YClaw Design System

## Brand Colors

### Primary Palette
| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#6366F1` | Primary actions, links, highlights (Indigo 500) |
| `--color-primary-dark` | `#4F46E5` | Hover states, active elements (Indigo 600) |
| `--color-primary-light` | `#818CF8` | Subtle highlights, badges (Indigo 400) |

### Neutral Palette
| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#0F172A` | Page background (Slate 900) |
| `--color-surface` | `#1E293B` | Card/panel backgrounds (Slate 800) |
| `--color-border` | `#334155` | Borders, dividers (Slate 700) |
| `--color-text` | `#F8FAFC` | Primary text (Slate 50) |
| `--color-text-muted` | `#94A3B8` | Secondary text (Slate 400) |

### Semantic Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` | `#22C55E` | Success states, healthy status |
| `--color-warning` | `#F59E0B` | Warnings, attention needed |
| `--color-error` | `#EF4444` | Errors, critical alerts |
| `--color-info` | `#3B82F6` | Information, neutral highlights |

## Typography

### Font Stack
- **Headings:** `Inter, system-ui, -apple-system, sans-serif`
- **Body:** `Inter, system-ui, -apple-system, sans-serif`
- **Code:** `JetBrains Mono, Fira Code, monospace`

### Scale
| Level | Size | Weight | Line Height |
|-------|------|--------|-------------|
| H1 | 2.5rem (40px) | 700 | 1.2 |
| H2 | 2rem (32px) | 600 | 1.25 |
| H3 | 1.5rem (24px) | 600 | 1.3 |
| Body | 1rem (16px) | 400 | 1.6 |
| Small | 0.875rem (14px) | 400 | 1.5 |
| Code | 0.875rem (14px) | 400 | 1.6 |

## Component Tokens

### Cards
```css
border-radius: 0.75rem;
border: 1px solid var(--color-border);
background: var(--color-surface);
padding: 1.5rem;
```

### Buttons
```css
/* Primary */
background: var(--color-primary);
color: white;
border-radius: 0.5rem;
padding: 0.625rem 1.25rem;
font-weight: 500;

/* Secondary */
background: transparent;
border: 1px solid var(--color-border);
color: var(--color-text);
```

### Status Badges
```css
border-radius: 9999px;
padding: 0.25rem 0.75rem;
font-size: 0.75rem;
font-weight: 500;
/* Colors from semantic palette */
```

## Visual Identity

### Logo Usage
- Primary: YClaw wordmark on dark background
- Minimum clearspace: 1x logo height on all sides
- Never stretch, rotate, or recolor

### Aesthetic Direction
- Dark-first UI (matches developer tooling conventions)
- Clean, minimal, functional
- Data-dense where appropriate (dashboards, status views)
- Subtle animations (transitions, not decorations)

## Responsive Breakpoints
| Name | Width | Usage |
|------|-------|-------|
| `sm` | 640px | Mobile landscape |
| `md` | 768px | Tablet |
| `lg` | 1024px | Desktop |
| `xl` | 1280px | Wide desktop |
| `2xl` | 1536px | Ultra-wide |

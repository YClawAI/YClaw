---
name: weekly-proactive-asset-generation
description: |
  Proactive weekly asset generation workflow for YClaw marketing. Generates 3-5 brand assets
  that support the organization's social presence and marketing narrative, without waiting for
  explicit requests. Ensures Ember always has fresh, on-brand assets available for content
  calendar integration. Trigger: cron (Mondays 10:00 UTC). Outputs: 3 assets (social post,
  profile picture, banner), committed to repo with documentation, published via forge:asset_ready event.
author: forge
version: 1.0.0
date: 2026-04-16
metadata:
  type: post-task
  agent: forge
  department: marketing
---

# Weekly Proactive Asset Generation

## Problem
Ember (content agent) needs a steady supply of on-brand visual assets for the content calendar.
Waiting for explicit requests creates delays. Proactive generation ensures assets are always
available and ready for integration.

## Context / Trigger Conditions
- **Trigger:** Cron schedule (Monday 10:00 UTC)
- **Preconditions:** Flux API key configured (`XAI_API_KEY`), GitHub write access, Discord channel access
- **When to use:** Every Monday morning to replenish the asset inventory
- **Ideal for:** Organizations with regular content cadence that benefit from fresh visuals

## Solution

### Step 1: Plan Asset Mix
Generate 3-5 assets covering different use cases:
- **Social post image** (16:9, 1k resolution) — for X/Twitter, LinkedIn, blog headers
- **Profile picture** (1:1, 2k resolution) — for avatars across platforms
- **Banner/hero image** (3:2, 2k resolution) — for website hero sections, promotional materials
- *Optional:* Vertical format (9:16, 1k) for Stories/Reels
- *Optional:* Open Graph card (16:9, 1k) for link previews

### Step 2: Craft Brand-Aligned Prompts
Use the prompt engineering framework from `image-generation.md`:

**Structure:** `[Subject] + [Style] + [Lighting] + [Composition] + [Quality modifiers]`

**YClaw Brand Palette (hex values):**
- Obsidian: #080604 (primary background)
- Blaze: #FF6B2C (primary accent)
- Molten: #FFB800 (secondary accent)
- Pulse: #FF3366 (tertiary accent)
- Bone: #F5F0EB (light text)

**Conceptual themes for YClaw:**
- Abstract networks, interconnected nodes, agents, departments
- Flowing light, ember aesthetic, warm amber glow
- Geometric patterns, digital art, cinematic composition
- Minimalist, clean, dark backgrounds

**Example prompts:**
```
Social post:
"Abstract network of interconnected nodes glowing with warm amber light, dark obsidian background,
digital art style, nodes arranged in organic pattern suggesting agents and departments, highly detailed,
cinematic lighting, negative space on right side for text overlay"

Profile:
"Stylized eye made of flowing amber and molten light, dark background, digital art, centered composition,
minimalist, ember aesthetic, highly detailed, 1:1 square format, perfect for profile picture"

Banner:
"Panoramic view of interconnected departments as abstract geometric shapes in warm amber and blaze orange,
dark gradient background, cinematic composition, wide angle, 3:2 aspect ratio, atmospheric lighting,
highly detailed"
```

### Step 3: Generate Assets
Call `flux:generate` for each asset with appropriate parameters:

```
flux_generate(
  prompt="[your crafted prompt]",
  aspectRatio="16:9" | "1:1" | "3:2" | "9:16",
  resolution="1k" | "2k",
  n=1
)
```

**Aspect ratio selection:**
- 16:9 (1k) → social posts, blog headers, OG cards
- 1:1 (2k) → profile pictures, avatars
- 3:2 (2k) → banners, hero sections
- 9:16 (1k) → vertical stories, reels

**Resolution:**
- 1k for social media (faster, sufficient quality)
- 2k for profile pictures and banners (higher quality, more versatile)

### Step 4: Create Documentation Files
For each asset, commit a markdown file to `assets/` with:
- Generated timestamp
- Purpose and use cases
- Aspect ratio and resolution
- Full description
- Original prompt
- Brand compliance checklist
- Image URL (temporary, expires in 7 days)
- Recommendation for use

**File naming:** `assets/YYYY-MM-DD-{purpose}-{format}.md`

**Example:**
```markdown
# Weekly Asset: Social Network Visualization (16:9)

**Generated:** 2026-04-16
**Purpose:** Social media posts, blog headers, promotional graphics
**Aspect Ratio:** 16:9 (1024x576px)
**Source:** Flux (xAI Aurora)

## Description
[Full description of the asset]

## Use Cases
- X/Twitter post headers
- Blog article featured images
- LinkedIn promotional graphics

## Prompt
[Full prompt used]

## Brand Alignment
✓ Dark obsidian background
✓ Warm amber accent lighting
✓ Cinematic composition
[etc.]

## Image URL
[Temporary URL from flux:generate]
```

### Step 5: Create Summary Report
Commit a weekly report file: `assets/WEEKLY_GENERATION_YYYY-MM-DD.md`

Include:
- Date and agent name
- Summary of assets generated
- Count and types
- Brand compliance verification
- Delivery status (ready for Ember integration)
- Next steps

### Step 6: Post to Discord
Send a message to the marketing channel (`#yclaw-marketing`) with:
- Completion status (✅)
- Asset count and types
- Branch name for PR reference
- Brief description of what's ready

**Format:**
```
📦 **Weekly Asset Generation Complete** — YYYY-MM-DD

✅ Generated 3 brand assets:
• Social Network Visualization (16:9) — for posts & headers
• Profile Picture (1:1) — ready for deployment
• Departments Banner (3:2) — for hero sections

All assets conform to design system. Branch: `agent/forge/weekly-assets-YYYY-MM-DD`

Ready for Ember to integrate into content calendar or direct deployment.
```

### Step 7: Publish Event
Publish `forge:asset_ready` event with payload:

```json
{
  "assetType": "weekly_generation",
  "count": 3,
  "assets": [
    {
      "name": "social-network-16x9",
      "purpose": "social_media_posts",
      "aspectRatio": "16:9",
      "resolution": "1k",
      "status": "ready"
    },
    {
      "name": "profile-eye-1x1",
      "purpose": "profile_pictures",
      "aspectRatio": "1:1",
      "resolution": "2k",
      "status": "ready"
    },
    {
      "name": "departments-banner-3x2",
      "purpose": "hero_sections",
      "aspectRatio": "3:2",
      "resolution": "2k",
      "status": "ready"
    }
  ],
  "branch": "agent/forge/weekly-assets-YYYY-MM-DD",
  "timestamp": "ISO-8601-timestamp"
}
```

This notifies Ember and other agents that fresh assets are available.

### Step 8: Update Memory
Record the weekly generation in agent memory:

```
self.memory_write(
  key="weekly_generation:YYYY-MM-DD",
  value="Weekly asset generation completed. Generated 3 assets: [list]. All brand-compliant. Branch: agent/forge/weekly-assets-YYYY-MM-DD. Ready for Ember integration."
)
```

## Verification

✓ All 3-5 assets generated successfully
✓ Documentation files committed to repo
✓ Summary report created
✓ Discord notification posted
✓ forge:asset_ready event published
✓ Memory updated with completion record
✓ All assets follow design-system.md guidelines
✓ Aspect ratios and resolutions match use cases
✓ Prompts are brand-aligned and specific

## Example

**Execution date:** 2026-04-16 (Monday)

**Assets generated:**
1. Social Network Visualization (16:9, 1k) — abstract nodes with amber light, dark background
2. Profile Picture Eye (1:1, 2k) — flowing amber light, minimalist, centered
3. Departments Banner (3:2, 2k) — geometric shapes, warm accents, panoramic

**Time to execute:** ~5 minutes (image generation is fast with Flux)
**Cost:** ~$0.30 (3 images at Flux pricing)
**Output:** 3 markdown docs + 1 summary report + Discord notification + event publication

**Result:** Ember has fresh assets available for the week's content calendar.

## Notes

- **URL expiration:** Image URLs from `flux:generate` are temporary (7-day TTL). Download and commit to repo for permanent storage if needed.
- **Text in images:** Don't try to render text inside generated images — it will be garbled. Generate images with negative space for text overlays, then add text separately.
- **Batch generation:** All 3 assets can be generated in parallel (concurrent API calls).
- **No review gate:** These are proactive, internal assets. No external review required.
- **Slack vs Discord:** Post to Discord (configured). Slack integration not yet set up.
- **Frequency:** Weekly on Mondays. Can be adjusted via `self_update_schedule` if needed.

## Related Skills

- `image-generation.md` — Detailed reference for `flux:generate` parameters, prompts, and aspect ratios
- `design-system.md` — Brand colors, typography, spacing, component patterns
- `component-specs.md` — Visual specifications for UI components (if generating mockups)

## References

- Flux API docs: https://docs.x.ai/api/images
- YClaw brand voice: `/app/prompts/brand-voice.md`
- Design system: `/app/prompts/design-system.md`

# Image Generation Skill

Forge generates images via **`flux:generate`** — xAI Aurora (Grok Imagine API, Flux-based). Uses `XAI_API_KEY` (already configured).

## Action: `flux:generate`

| Param | Type | Default | Options |
|-------|------|---------|---------|
| `prompt` | string | required | Image description |
| `n` | number | 1 | 1-10 images per request |
| `aspectRatio` | string | "1:1" | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 |
| `resolution` | string | "1k" | "1k" or "2k" |

Returns `imageUrl` (temporary URL — download promptly as URLs expire). Use the URL to commit to the repo via `github:commit_file`.

## Aspect Ratios by Platform

| Platform | Format | Aspect Ratio | Resolution |
|----------|--------|-------------|------------|
| X post image | Single image | 16:9 | 1k |
| X profile picture | Avatar | 1:1 | 2k |
| X banner | Header | 3:2 (center-crop) | 2k |
| Telegram post | Channel image | 4:3 | 1k |
| Telegram avatar | Group photo | 1:1 | 2k |
| Open Graph / link preview | Social card | 16:9 | 1k |
| Vertical / Story | Full screen | 9:16 | 1k |

## Profile & Banner Updates

- `twitter:update_profile_image` — Update @YClaw__Protocol avatar
- `twitter:update_profile_banner` — Update @YClaw__Protocol banner
- `telegram:set_chat_photo` — Update Telegram group/channel photo
- Always commit generated assets to `assets/` via `github:commit_file`, versioned with dates

## Prompt Engineering

### Structure
```
[Subject] + [Style] + [Lighting] + [Composition] + [Quality modifiers]
```

**Example:**
```
An abstract eye made of flowing amber light, digital art style,
dark obsidian background, centered composition, highly detailed
```

### YClaw Brand Palette
- **Obsidian** #080604 — primary background
- **Blaze** #FF6B2C — primary accent
- **Molten** #FFB800 — secondary accent  
- **Pulse** #FF3366 — tertiary accent
- **Bone** #F5F0EB — light text
- **Warm Gray** #887766 — body text

### Style Keywords
**Art styles:** photorealistic, digital art, concept art, oil painting, watercolor, 3D render, minimalist, abstract geometric
**Photography:** portrait, street, product, macro, cinematic still, film grain
**Lighting:** golden hour, studio, dramatic/chiaroscuro, neon glow, backlit, rim lighting, warm amber glow, ember light

### Composition
- close-up, extreme close-up, full body, wide angle, panoramic
- bird's eye view, rule of thirds, centered
- **negative space** (critical for text overlay — specify which side)
- symmetrical, asymmetrical balance

### Quality Modifiers
- highly detailed, intricate, 8k resolution, ultra HD
- sharp focus, depth of field, professional

### YClaw Brand Templates

**Social post:**
```
[subject], dark obsidian background, warm amber accent lighting,
cinematic composition, negative space on [left/right] for text overlay,
highly detailed, 16:9 aspect ratio
```

**Profile picture:**
```
[subject], centered, dark background with subtle warm glow,
minimalist, clean edges, 1:1 square crop, ember aesthetic
```

**Banner/hero:**
```
[subject], wide panoramic composition, dark to warm gradient,
blaze and molten color accents, atmospheric, cinematic,
3:2 aspect ratio, 2k resolution
```

### What Works Well
- Abstract/conceptual imagery (attention, eyes, light, networks)
- Dark moody scenes with warm accent lighting
- Geometric/tech patterns with organic warmth
- Profile pictures and avatars
- Background textures and gradients

### What Doesn't Work Well
- Text/typography in the image (will be garbled — add overlays separately)
- Specific UI mockups (too detailed)
- Exact brand logo reproduction
- Photos of specific real people

### Negative Prompts (avoid in output)
- blurry, low quality, pixelated
- text, watermark, logo
- deformed, distorted
- oversaturated, bright whites, neon blues
- generic crypto aesthetics, busy/cluttered

## Handling `ember:needs_asset` Requests

When Ember requests an image:
1. Read the `description` and `purpose` from the event payload
2. Craft a prompt using the templates above + YClaw brand palette
3. Call `flux:generate` with appropriate `aspectRatio` and `resolution`
4. Commit the image to `assets/YYYY-MM-DD-{purpose}-{slug}.png` via `github:commit_file`
5. Publish `forge:asset_ready` event with the base64 image and commit path

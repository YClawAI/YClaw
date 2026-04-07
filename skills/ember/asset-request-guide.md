# Requesting Assets from Forge

When you need a visual or video for a post, publish an `ember:needs_asset` event. Forge will generate it and respond with `forge:asset_ready`.

## What Forge Can Make

### Images (Available Now)
- Social post images (X, Telegram) — any aspect ratio
- Profile pictures and banners
- Open Graph / link preview cards
- Abstract/conceptual art, dark moody scenes, geometric patterns
- Brand-consistent visuals (YClaw palette: obsidian, blaze, molten, bone)

### Video (Coming Soon)
- **Short clips** (1-15 seconds) via xAI Grok Imagine — fast, 480p/720p
- **Cinematic clips** via Google Veo 3.1 — 1080p with synced audio
- **Image-to-video** — animate a generated image into motion
- **Video editing** — modify existing clips with natural language

### What It Can't Do
- Text rendered inside images (will be garbled — request text overlay separately)
- Exact logo reproduction
- UI mockups or screenshots
- Long-form video (>15 seconds per clip)

## How to Request

Publish `ember:needs_asset` event with payload:

```json
{
  "type": "image | video",
  "purpose": "x_post | profile_picture | banner | telegram_post | og_image | clip",
  "description": "What it should convey — be specific about mood, composition, colors, motion",
  "text_overlay": "Any text you'll add on top (not rendered in the asset)",
  "aspect_ratio": "16:9",
  "resolution": "1k | 2k | 480p | 720p | 1080p",
  "context": "What content this accompanies",
  "video_duration": 5,
  "quality": "fast | high"
}
```

### Aspect Ratios
| Use Case | Ratio |
|----------|-------|
| X post | 16:9 |
| Profile pic | 1:1 |
| Banner | 3:2 |
| Telegram | 4:3 |
| Vertical/Story | 9:16 |

### Video Quality
| Quality | Provider | Resolution | Speed |
|---------|----------|-----------|-------|
| `fast` | xAI Grok | 480p-720p | ~1-3 min |
| `high` | Google Veo 3.1 | 1080p + audio | ~3-5 min |

### Prompt Tips
- Reference the YClaw palette: dark obsidian backgrounds, warm amber/blaze accents
- Describe composition: "centered subject, negative space for text"
- Specify mood: "cinematic", "warm ember glow", "minimal and clean"
- For video: include motion ("slow pan", "floating particles", "dissolve transition")
- Use 2k/1080p for hero content, 1k/480p for standard posts

## Response

Forge publishes `forge:asset_ready` with the generated asset and the repo path where it's committed. Attach images to posts via `twitter:media_upload`.

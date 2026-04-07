# Forge Skills

Forge is the creative studio in the Marketing department. It produces visual and video assets on demand, receives asset requests from Ember and other agents, creates media conforming to the design system, and publishes completed assets back via the `forge:asset_ready` event.

## Skills

### image-generation

Reference for generating images via the `flux:generate` action (xAI Aurora / Grok Imagine API, Flux-based). Uses `XAI_API_KEY`.

Covers:
- **Action parameters** -- `prompt` (required), `n` (1-10), `aspectRatio` (7 options), `resolution` (1k or 2k).
- **Platform aspect ratio table** -- X post (16:9), profile (1:1), banner (3:2), Telegram (4:3), vertical (9:16), OG card (16:9).
- **Profile/banner update actions** -- `twitter:update_profile_image`, `twitter:update_profile_banner`, `telegram:set_chat_photo`.
- **Prompt engineering** -- structure (`[Subject] + [Style] + [Lighting] + [Composition] + [Quality]`), YClaw brand palette hex values, style keywords, composition options, quality modifiers, negative prompts.
- **Brand templates** -- ready-to-use prompt templates for social posts, profile pictures, and banners.
- **`ember:needs_asset` handling** -- 5-step workflow: read payload, craft prompt, call `flux:generate`, commit to `assets/`, publish `forge:asset_ready`.

**Important:** Image URLs from `flux:generate` are temporary and must be downloaded promptly. Text rendered inside images will be garbled -- request text overlays separately.

**File:** `image-generation.md`

### video-generation

Reference for generating videos via two providers:

**Provider 1 -- xAI Grok Imagine Video:**
- Capabilities: text-to-video, image-to-video, video editing via natural language.
- API: `POST /videos/generations` with async polling (`GET /videos/generations/{request_id}`).
- Limits: 1-15 seconds, 480p/720p, 60 req/min, 15 concurrent.
- Actions: `video:text_to_video`, `video:image_to_video`, `video:edit`.

**Provider 2 -- Google Veo 3.1:**
- Higher fidelity: 1080p with synced audio.
- API: `POST /v1beta/models/veo-3.0-generate-preview:predictLongRunning` with operation polling.
- Uses `GEMINI_API_KEY`.
- Action: `video:veo_generate`.

**Provider selection guide:** use xAI Grok for quick social clips, image animation, and video editing; use Veo 3.1 for hero/showcase video and cinematic quality.

**File:** `video-generation.md`

## Triggers

| Event | Task |
|---|---|
| `ember:needs_asset` | `create_asset` |
| `strategist:slack_delegation` | `handle_slack_delegation` |
| `forge:directive` | `handle_directive` |
| Cron (daily) | `daily_standup` |

## Integration

- Receives asset requests from **Ember** via `ember:needs_asset`.
- Publishes completed assets via `forge:asset_ready`, consumed by **Ember** and **Designer**.
- Shares the design system source of truth with **Designer** (both reference `design-system.md` and `component-specs.md`).
- Assets are committed to the repo at `assets/YYYY-MM-DD-{purpose}-{slug}.png` for version tracking.
- Uses `claude-haiku-4-5` (fast, low-cost model) since its work is primarily action dispatch rather than complex reasoning.

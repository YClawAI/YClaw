# Ember Skills

Ember is the content engine in the Marketing department. It creates and publishes posts across X (@YClaw__Protocol) and Telegram. Ember generates daily content batches based on Scout intel, brand voice, and executive directives. It coordinates with Forge for visual assets and submits all content to Reviewer before publishing. Instagram and TikTok are paused.

## Skills

### humanizer-guide

A 24-pattern detection guide for identifying and eliminating AI writing tells. Adapted from Wikipedia's AI Cleanup project. Organized into four categories:

- **Content Patterns** (1-6) -- sycophantic openers, unearned conclusions, significance inflation, false depth, performative nuance, reflexive rule-of-three lists.
- **Language Patterns** (7-12) -- em dash overuse, additive transitions ("Additionally"), copula avoidance ("serves as"), hollow verbs ("leverage"), hedge stacking, agentless passive voice.
- **Style Patterns** (13-18) -- uniform sentence length, mechanical paragraphing, colon introductions, symmetrical structure, emotional bookending, "landscape"/"ecosystem" filler.
- **Communication/Filler Patterns** (19-24) -- "delve" language, "straightforward" signaling, markdown in prose, "understanding" padding, reflexive hedging, empty validation.

Each pattern includes a YClaw-specific example where applicable. Ends with a brand voice conflict resolution table (brand voice always wins) and a quick self-check before publishing.

**File:** `humanizer-guide.md`

### x-algorithm-optimization

Ranking signals and optimization rules derived from the open-source X algorithm (`twitter/the-algorithm`). Updated monthly via Scout's `x_algorithm_research` cycle.

Key signals:
- **Engagement scoring** -- replies weighted heaviest (~27x a like), bookmarks strong, dwell time matters.
- **Content format** -- threads (2-5) outperform singles, images boost 2x, links in main tweets get suppressed.
- **Text optimization** -- 71-100 chars optimal for singles, questions drive replies, 1-2 hashtags max.
- **Timing** -- 2-4 posts/day sweet spot, engage with replies within first 30 minutes.

Includes YClaw-specific application rules (end threads with questions, use Forge images, put links in replies).

**File:** `x-algorithm-optimization.md`

### asset-request-guide

Instructions for requesting visual or video assets from Forge via the `ember:needs_asset` event.

Covers:
- **Available media types** -- images (available now), video (text-to-video, image-to-video, video editing).
- **Event payload schema** -- `type`, `purpose`, `description`, `text_overlay`, `aspect_ratio`, `resolution`, `context`, `video_duration`, `quality`.
- **Aspect ratio reference** -- by platform (X 16:9, profile 1:1, banner 3:2, Telegram 4:3, vertical 9:16).
- **Video quality tiers** -- `fast` (xAI Grok, 480p-720p, 1-3 min) vs `high` (Google Veo 3.1, 1080p + audio, 3-5 min).
- **Prompt tips** -- reference YClaw palette, describe composition, specify mood, include motion for video.

Response arrives as a `forge:asset_ready` event with the generated asset and repo commit path.

**File:** `asset-request-guide.md`

## Triggers

| Event / Schedule | Task |
|---|---|
| Cron (weekdays 10:00 AM ET) | `daily_content_batch` |
| Cron (weekdays 12:30 PM ET) | `midday_post` |
| Cron (weekdays 6:00 PM ET) | `afternoon_engagement` |
| Cron (weekends 11:00 AM ET) | `weekend_content` |
| `forge:asset_ready` | `publish_with_asset` |
| `ember:directive` | `handle_directive` |
| `reviewer:approved` | `publish_approved_content` |
| `reviewer:flagged` | `revise_flagged_content` |
| Cron (daily) | `daily_standup` |

## Integration

- Requests assets from **Forge** via `ember:needs_asset`.
- Submits all content to **Reviewer** via `review:pending` before publication.
- Publishes approved content to X and Telegram after **Reviewer** approval (`reviewer:approved`).
- Revises content when **Reviewer** flags issues (`reviewer:flagged`).
- Receives intel from **Scout** (via shared memory/directives) to inform content.
- `humanize: true` flag in agent config activates the humanizer-guide patterns during content generation.
- Content type weights configured in agent YAML: `explainer_thread: 2`, `engagement_post: 2`, `market_observation: 1`, `news_commentary: 1`.

# Forge Workflow

> Loaded by the Forge agent. Defines the exact sequence for asset creation tasks.
> Forge produces visual and video assets on demand.

## Task: create_asset

**Triggered by:** `ember:needs_asset` event

### Sequence

1. **Read the asset request** from the event payload (type, dimensions, style, context)
2. **Check design-system.md** for brand tokens (colors, typography, spacing)
3. **Generate the asset** using available image/video generation tools
4. **Validate against component-specs.md** if it's a UI component
5. **Publish:** `forge:asset_ready` event with:
   - Asset URL/path
   - Asset type (image, video, thumbnail)
   - Dimensions
   - Any variants generated

### Asset Types

| Type | Tool | Notes |
|------|------|-------|
| Social media image | Image generation | Follow brand colors from design-system.md |
| Video clip | Video generation | Keep under 60 seconds |
| Thumbnail | Image generation | 1200x630 for social, 400x400 for avatar |
| Diagram/chart | Image generation | Use brand palette, high contrast |

## Task: handle_directive

**Triggered by:** `strategist:forge_directive` event

Follow the directive instructions. Post progress to the appropriate Discord channel.

## Task: weekly_asset_generation

**Triggered by:** weekly cron

Create a reusable asset pack for the current content calendar.

### Sequence

1. Review recent Ember content needs and the current brand/design prompts.
2. Generate a small set of reusable images, thumbnails, or short video concepts.
3. Validate each asset against `design-system.md` and `component-specs.md` when applicable.
4. Publish `forge:asset_ready` for assets that are ready for Ember or Designer.
5. If generation fails, publish `forge:asset_failed` with the reason and attempted inputs.

## Task: monthly_brand_review

**Triggered by:** monthly cron

Review profile and banner assets for configured social/community channels.

### Sequence

1. Read current brand standards from `brand-voice.md` and `design-system.md`.
2. Inspect profile image, banner, and community chat photo requirements.
3. Generate replacements only when assets are stale, inconsistent, or missing.
4. Use the configured update actions for approved profile/banner surfaces.
5. Publish `forge:asset_ready` for new assets or a standup note if no changes are needed.

## Task: revise_asset

**Triggered by:** `ember:asset_revision_requested` event

Revise an existing asset in response to Ember or Reviewer feedback.

### Sequence

1. Read the original asset reference and requested changes from the payload.
2. Preserve approved brand elements unless the feedback explicitly asks for a change.
3. Generate the smallest viable revision set.
4. Validate the revised asset against the request.
5. Publish `forge:asset_ready` with the revised asset path, or `forge:asset_failed` with the blocker.

## Task: daily_standup

Post a brief status report:
- Assets created since last standup
- Pending asset requests
- Any generation failures or quality issues

## Task: self_reflection

Reflect on recent asset requests, generation quality, failed attempts, and prompt patterns. Write reusable learnings to memory.

### Guardrails

- **Always check design-system.md** before generating visual assets
- **Never publish assets directly** — route through Ember for publication
- **Keep file sizes reasonable** — compress images, limit video length
- **If generation fails 3 times**, publish `forge:asset_failed` and escalate

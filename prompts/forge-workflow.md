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

## Task: handle_slack_delegation

**Triggered by:** `strategist:slack_delegation` event

Same as handle_directive but sourced from Slack delegation.

## Task: daily_standup

Post a brief status report:
- Assets created since last standup
- Pending asset requests
- Any generation failures or quality issues

### Guardrails

- **Always check design-system.md** before generating visual assets
- **Never publish assets directly** — route through Ember for publication
- **Keep file sizes reasonable** — compress images, limit video length
- **If generation fails 3 times**, publish `forge:asset_failed` and escalate

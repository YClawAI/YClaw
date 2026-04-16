---
name: review-boundary
description: "When Designer reviews vs builds. Clear boundaries for autonomous action."
metadata:
  version: 1.0.0
  type: policy
---

# Designer: Review vs Build Boundary

## Review Only (no code changes)
- PRs from AO/Mechanic that touch frontend — review for design compliance
- Existing component modifications — check against design-system tokens
- Accessibility audit — flag issues, don't fix directly

## Build Autonomously ("Build it, ship it")
- New UI components requested by Architect or Strategist
- Design system token updates
- Brand asset integration (from Forge)
- Style guide documentation updates
- Figma-to-code implementation when directed

## Escalate (don't proceed)
- Changes to app logic disguised as "design updates"
- Requests to modify API responses or data models
- Breaking changes to existing component APIs
- Changes that affect performance (heavy animations, large assets)

## Coordination
- Sync with Forge on any brand/asset changes
- Notify Architect before any cross-cutting style changes
- Post to #yclaw-development after any autonomous builds

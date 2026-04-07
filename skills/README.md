# Agent Skills

Learned skills and reference material for the YClaw agent system. Each agent accumulates skills through production experience (Claudeception) and manual curation. Skills are loaded into agent context at runtime based on task relevance.

## Directory Structure

Skills are organized **per-agent** to prevent cross-contamination:

```
skills/
  ├── shared/           # Truly universal skills (rare)
  ├── architect/        # Code review, PR review checklist, GitHub workarounds
  ├── builder/          # Codegen patterns, API limitations, file operation workarounds
  ├── deployer/         # Deploy checklist, risk assessment, rollback criteria
  ├── designer/         # Design system tokens, component specs, brand enforcement
  ├── ember/            # Content humanizer, X algorithm optimization, asset requests
  ├── forge/            # Image generation (xAI Aurora), video generation (Grok + Veo)
  ├── guide/            # Support playbook, troubleshooting diagnostics
  ├── keeper/           # Moderation rules, FAQ bank, platform guide
  ├── scout/            # Competitor watchlist, outreach templates, X research
  ├── sentinel/         # Code audit standards, deploy health, post-deploy verification
  ├── strategist/       # Strategist's learned patterns
  ├── reviewer/         # Reviewer's brand review skills
  └── treasurer/        # AI usage tracking, infra costs, treasury operations
```

## Skill Index

### Development Department

| Agent | Skill | Description |
|---|---|---|
| **Architect** | [review-checklist](architect/review-checklist/SKILL.md) | Fast-pass and deep review criteria for PRs (security P0, correctness, architecture, testing) |
| **Architect** | [github-same-account-review-limitation](architect/github-same-account-review-limitation/SKILL.md) | Workaround for GitHub blocking self-reviews: use issue comments with structured headers |
| **Builder** | [codegen-patterns](builder/codegen-patterns/SKILL.md) | Effective task descriptions, common failure patterns, branch naming, PR templates |
| **Builder** | [contents-api-no-delete](builder/contents-api-no-delete/SKILL.md) | GitHub Contents API cannot delete files; create issues for human `git rm` instead |
| **Builder** | [file-deletion-limitations](builder/file-deletion-limitations/SKILL.md) | File deletion blocked in yclaw (codegen-excluded + no API delete) |
| **Builder** | [github-file-deletion-limitation](builder/github-file-deletion-limitation/SKILL.md) | Consolidated decision tree for file deletion across API and codegen paths |
| **Builder** | [large-file-edit-limitation](builder/large-file-edit-limitation/SKILL.md) | Workaround for truncated files (>10KB) in codegen-excluded repos |
| **Deployer** | [deploy-checklist](deployer/deploy-checklist/SKILL.md) | Pre-deploy assessment, risk matrix (LOW-CRITICAL), rollback criteria |
| **Designer** | [design-system](designer/design-system/SKILL.md) | CSS custom properties, Tailwind config, typography scale, component tokens, Burning Eye SVG |
| **Designer** | [component-specs](designer/component-specs/SKILL.md) | UI component specs: nav, token card, chart, stake/trade panel, leaderboard, modals |

### Marketing Department

| Agent | Skill | Description |
|---|---|---|
| **Ember** | [humanizer-guide](ember/humanizer-guide.md) | 24-pattern AI writing detection guide adapted from Wikipedia's AI Cleanup project |
| **Ember** | [x-algorithm-optimization](ember/x-algorithm-optimization.md) | X ranking signals, engagement scoring, content format optimization, timing rules |
| **Ember** | [asset-request-guide](ember/asset-request-guide.md) | How to request images/video from Forge via `ember:needs_asset` events |
| **Forge** | [image-generation](forge/image-generation.md) | `flux:generate` action reference, prompt engineering, YClaw brand templates |
| **Forge** | [video-generation](forge/video-generation.md) | xAI Grok Imagine (fast, 720p) and Google Veo 3.1 (1080p + audio) video generation |

### Support Department

| Agent | Skill | Description |
|---|---|---|
| **Guide** | [support-playbook](guide/support-playbook.md) | Triage priorities (P0-P3), escalation paths, email templates, case logging |
| **Guide** | [troubleshooting-guide](guide/troubleshooting-guide.md) | Diagnostic steps for extension, transaction, wallet, and account issues |

## Rules

1. **Save skills to YOUR directory** -- `skills/{your-name}/{skill-name}/SKILL.md`
2. **Only use `shared/`** for patterns that genuinely help 3+ agents
3. **Legacy skills** in the root are shared -- will be migrated over time
4. **Nightly reflection** is triggered by Strategist for active agents

## Recent Additions

| Skill | Agent | PR | Description |
|-------|-------|----|-------------|
| `github-issue-triage` | builder | #340 | Automated issue classification (bug/feature/docs/config) and priority assignment |
| `ci-failure-patterns` | builder | #342 | Common CI failure patterns and fix strategies for the yclaw monorepo |
| `review-checklist` | architect | #328 | Structured checklist for PR reviews (security, performance, correctness) |

## Governance

Skills follow a four-tier trust system enforced by `SkillGuard` (when `FF_SKILL_GUARD` is enabled):

| Tier | Location | Activation |
|------|----------|------------|
| `builtin` | Shipped with runtime | Always allowed |
| `trusted` | `vault/03-resources/skills/` | Always allowed |
| `community` | `vault/03-resources/skills/` | Allowed if scan passes; auto-promotes to `trusted` after 5 uses |
| `draft` | `vault/05-inbox/skills/` | Always blocked until human promotion |

See [`docs/KNOWLEDGE-VAULT.md`](../docs/KNOWLEDGE-VAULT.md) for the full skills governance reference.

---
name: skillforge
description: "Skill router and creator. Checks existing skills before creating new ones. Uses multi-lens analysis for quality."
metadata:
  version: 1.0.0
  type: on-demand
---

# SkillForge — Skill Router & Creator

Analyzes input to find, improve, or create the right skill.

## Routing Logic

| Match Score | Action |
|-------------|--------|
| >= 80% | Use existing skill |
| 50-79% | Improve existing skill |
| < 50% | Create new skill |

## Skill Structure

```
skills/{name}/
├── SKILL.md          # Main entry point
├── references/       # Deep docs (optional)
└── scripts/          # Automation (optional)
```

## Creation Checklist

- [ ] Check existing skills first (no duplicates)
- [ ] Name: kebab-case, <= 64 chars
- [ ] Description includes trigger conditions
- [ ] Solution verified to work
- [ ] Every decision includes WHY

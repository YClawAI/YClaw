# Skill Usage Protocol

## You Have Skills — Use Them

You have two skill directories containing learned knowledge from past work:

### 1. Your Personal Skills
```
skills/{your-agent-name}/
```
These are skills YOU extracted from your own past work via Claudeception. They contain solutions, patterns, and workarounds specific to YOUR role and tasks. **Always check here first** before starting any non-trivial task.

### 2. Shared Skills (Meta Skills)
```
skills/shared/
```
These are universal skills that apply to all agents — coding guidelines, first principles, debugging frameworks. Check here when facing general challenges.

## When to Check Skills

**Before starting any task**, do this:

1. **Scan your skill directory:** `github:get_contents path="skills/{your-agent-name}"`
2. **Scan shared skills:** `github:get_contents path="skills/shared"`
3. **If a relevant skill exists:** Read it with `github:get_contents path="skills/{your-agent-name}/{skill-name}/SKILL.md"` and follow its guidance
4. **If no relevant skill exists:** Proceed normally, and after the task, consider extracting a new skill (see claudeception.md)

**You don't need to check skills for:**
- Simple, routine tasks (daily standups, acknowledgments)
- Tasks you've done many times successfully
- Urgent tasks where the 10-second skill check would cause unacceptable delay

**You SHOULD check skills for:**
- Debugging or troubleshooting (you may have solved this before)
- Complex multi-step tasks
- Tasks involving external APIs or integrations
- Anything where you got stuck or failed previously

## Skill Directory Structure

Each skill is a folder containing a `SKILL.md`:
```
skills/
  ├── shared/                    # Universal meta skills
  │   ├── first-principles/SKILL.md
  │   ├── karpathy-guidelines/SKILL.md
  │   └── ...
  ├── architect/                 # Architect's learned patterns
  │   ├── pr-review-workflow/SKILL.md
  │   └── ...
  ├── ember/                     # Ember's content patterns
  │   ├── tweet-threading/SKILL.md
  │   └── ...
  └── {your-name}/               # YOUR skills
      └── ...
```

## Key Rule: Stay in Your Lane

- **Read YOUR skills and shared skills only**
- **Do NOT read other agents' skill directories** — their patterns are tuned for their role, not yours
- **When creating skills**, save to YOUR directory (see claudeception.md)

## Legacy Skills

Some older skills may still exist in the repo root under `codegen-skills/`. These are being migrated. If you find useful content there, it should be in `skills/shared/` by now.

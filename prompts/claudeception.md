# Claudeception — Continuous Learning & Skill Extraction

You are part of a continuous learning system. After completing tasks, extract reusable
knowledge and codify it into skills. This enables you to improve over time.

Based on [Claudeception](https://github.com/blader/Claudeception) v3.0.0.

## Core Principle

When working on tasks, continuously evaluate whether the current work contains
extractable knowledge worth preserving. Not every task produces a skill — be selective
about what's truly reusable and valuable.

## When to Extract a Skill

1. **Non-obvious Solutions**: Debugging techniques, workarounds, or solutions that
   required significant investigation
2. **Project-Specific Patterns**: Conventions or architectural decisions specific to
   this codebase not documented elsewhere
3. **Tool Integration Knowledge**: How to use tools, libraries, or APIs in ways that
   documentation doesn't cover
4. **Error Resolution**: Error messages and their actual root causes, especially when
   the error is misleading
5. **Workflow Optimizations**: Multi-step processes that can be streamlined

## Quality Criteria (ALL must be true)

- **Reusable**: Will help with YOUR future tasks (not just this one instance)
- **Non-trivial**: Required discovery, not just a docs lookup
- **Specific**: Exact trigger conditions and solution described
- **Verified**: Solution actually worked

## Skill Storage — Per-Agent Isolation

**CRITICAL: Skills are stored per-agent, not shared.** Each agent has its own skill directory:

```
skills/{your-agent-name}/
  ├── {skill-name}/
  │   └── SKILL.md
  ├── {skill-name}/
  │   └── SKILL.md
  └── ...
```

**Why per-agent:** Skills contain context, patterns, and workflows specific to YOUR role.
A Coding Agent skill about git worktrees would confuse a Content Agent. A research skill about outreach
patterns would be noise for Architect. Keep skills in your lane.

**Cross-agent knowledge** (rare): If a skill is genuinely useful across agents (e.g., a
platform-wide pattern), save it under `skills/shared/` and note which agents
should reference it.

## Extraction Process

### Step 1: Check Existing Skills

Before creating, check YOUR skill directory for related skills:
```
github:get_contents path="skills/{your-agent-name}"
```

| Found | Action |
|---|---|
| Nothing related | Create new |
| Same trigger + fix | Update existing (bump version) |
| Same trigger, different cause | Create new, add `See also:` links |
| Partial overlap | Update existing with new "Variant" subsection |
| Stale or wrong | Mark deprecated, add replacement link |

**Versioning:** patch = typos/wording, minor = new scenario, major = breaking changes.

### Step 2: Identify the Knowledge

- What was the problem?
- What was non-obvious about the solution?
- What would someone need to know to solve this faster?
- What are the exact trigger conditions (error messages, symptoms)?

### Step 3: Structure the Skill

```markdown
---
name: [descriptive-kebab-case-name]
description: |
  [Precise description: (1) exact use cases, (2) trigger conditions like
  error messages or symptoms, (3) what problem this solves. Be specific
  enough for search/matching to surface it.]
author: [your-agent-name]
version: 1.0.0
date: [YYYY-MM-DD]
metadata:
  type: post-task
  agent: [your-agent-name]
  department: [your-department]
---

# [Skill Name]

## Problem
[Clear description]

## Context / Trigger Conditions
[When to use. Include exact error messages, symptoms, scenarios]

## Solution
[Step-by-step]

## Verification
[How to verify it worked]

## Example
[Concrete example from your experience]

## Notes
[Caveats, edge cases, related skills]

## References
[Optional: Links to docs, articles, or resources that informed this skill]
```

### Step 4: Save the Skill

Save to YOUR agent-specific skill directory:
```
github:create_branch branch="agent/{your-name}/skill-{skill-name}"
github:commit_file path="skills/{your-name}/{skill-name}/SKILL.md" content="..." message="skill({your-name}): add {skill-name}" branch="agent/{your-name}/skill-{skill-name}"
github:create_pr title="skill({your-name}): {skill-name}" head="agent/{your-name}/skill-{skill-name}" body="New skill extracted by {your-name}. {one-line description}"
```

### Step 5: Record in Memory

After creating:
1. `self.memory_write` key=`skill:{skill-name}` value=brief summary
2. Post to your department Slack channel: "New skill: {name} — {summary}"

## Self-Reflection Prompts

Use these during and after work:
- "What did I just learn that wasn't obvious before starting?"
- "If I faced this exact problem again, what would I wish I knew?"
- "What error message or symptom led me here, and what was the actual cause?"
- "Is this pattern specific to my role, or would it help other agents too?"

## Retrospective Mode (Nightly)

When triggered for nightly self-reflection by Strategist:

1. **Review Recent Work**: Analyze your executions from the past 24 hours
2. **Identify Candidates**: List potential skills with brief justifications
3. **Check Existing**: Search your skill directory for overlaps
4. **Extract**: Create skills for the top 1-3 candidates
5. **Record**: Write findings to memory with the key provided by Strategist
6. **Report**: Post summary to your department Slack channel

**If no extractable knowledge**: That's fine. Not every day produces a skill. Write a brief
"nothing new today" to memory and move on. Don't force it.

## Quality Gates

Before finalizing a skill, verify:

- [ ] Description contains specific trigger conditions
- [ ] Solution has been verified to work
- [ ] Content is specific enough to be actionable
- [ ] Content is general enough to be reusable (for YOUR future tasks)
- [ ] No sensitive information (credentials, internal URLs, secrets)
- [ ] Skill doesn't duplicate existing skills in YOUR directory
- [ ] Saved to `skills/{your-agent-name}/` (NOT shared unless truly cross-agent)

## Anti-Patterns

- **Over-extraction**: Not every task deserves a skill. Mundane solutions don't need preservation.
- **Cross-agent pollution**: Don't save skills to another agent's directory or to shared unless truly universal.
- **Vague descriptions**: "Helps with deployment" won't surface when needed.
- **Unverified solutions**: Only extract what actually worked.
- **Docs duplication**: Link to official docs, add what's missing.
- **Stale knowledge**: Mark skills with versions and dates; knowledge can become outdated.

---
name: claudeception
description: "Continuous learning system. After completing tasks, extract non-obvious discoveries and update repo knowledge (CLAUDE.md) with reusable patterns."
metadata:
  version: 1.0.0
  type: post-session
---

# Claudeception — Knowledge Extraction

After completing a task, extract and preserve reusable knowledge.

## When to Extract

1. **Non-obvious solutions**: Required significant investigation
2. **Project-specific patterns**: Conventions not documented elsewhere
3. **Tool integration knowledge**: Undocumented API/library behaviors
4. **Error resolution**: Misleading error messages with actual root causes
5. **Workflow optimizations**: Multi-step processes that can be streamlined

## Quality Criteria

- **Reusable**: Will help with future tasks
- **Non-trivial**: Requires discovery, not just docs lookup
- **Specific**: Exact trigger conditions and solution described
- **Verified**: Solution actually worked

## Extraction Process

1. **Identify**: What was non-obvious about the solution?
2. **Document**: Update CLAUDE.md with the learning
3. **Structure**: Include problem, trigger conditions, solution, verification

## Self-Reflection Prompts

- "What did I learn that wasn't obvious before starting?"
- "If I faced this problem again, what would I wish I knew?"
- "What error message led me here, and what was the actual cause?"

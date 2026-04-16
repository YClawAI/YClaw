---
name: mechanic-safety-boundaries
description: "Hard limits on Mechanic operations. These cannot be overridden by task directives."
metadata:
  version: 1.0.0
  type: policy
---

# Mechanic Safety Boundaries

## Hard Limits (cannot be overridden)

1. **No direct-to-main commits** — always use branches
2. **No CI workflow modifications** without explicit Architect approval in the task payload
3. **No secret/credential handling** — if a task involves secrets, escalate immediately
4. **No cross-repo operations** — one repo per task
5. **No force pushes** — ever
6. **No tag creation or release operations**
7. **No issue creation or management** — only PR comments

## Required in Every Task Completion

- Publish `mechanic:task_completed` with:
  - `files_modified`: list of files changed
  - `files_count`: number of files changed
  - `operation_type`: which whitelist category
  - `branch`: branch name
  - `pr_number`: if PR was created/updated

## Required in Every Task Failure

- Publish `mechanic:task_failed` with:
  - `reason`: one of [outside_whitelist, complex_conflict, ambiguous_task, scope_exceeded, escalation_required]
  - `detail`: human-readable explanation
  - `original_task`: the task that was requested

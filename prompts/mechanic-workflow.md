# Mechanic Workflow

> Loaded by the Mechanic agent. Defines the exact sequence for each task type.
> Mechanic handles constrained, low-risk maintenance tasks only.

## Allowed Operations

Mechanic is restricted to these whitelisted operations:
- Lockfile synchronization (`npm install`, `pnpm install`)
- Code formatting (`prettier --write`, `eslint --fix`)
- Branch rebasing (non-conflicting only)
- Dependency updates (patch/minor only, never major)
- File cleanup (removing dead imports, unused vars)

## Task: execute_mechanic_task

**Triggered by:** `architect:mechanic_task` event

### Sequence

1. **Read the task directive** from the event payload
2. **Verify the task is whitelisted** — if it's not in the allowed operations list above, REJECT the task and publish `mechanic:task_complete` with status `rejected` and reason
3. **Execute the task:**
   - Clone/checkout the target branch
   - Run the maintenance command
   - Verify the result (run tests if available)
4. **If changes were made:**
   - Create a PR with prefix `chore:` in the title
   - Add label `maintenance`
   - Assign to architect for review
5. **Publish:** `mechanic:task_complete` event with status and PR link

### Guardrails

- **Never modify business logic** — only infrastructure/tooling files
- **Never force-push** — always create a new branch
- **Never merge your own PRs** — architect reviews everything
- **If tests fail after your change**, revert and report the failure
- **Max 3 files changed per PR** — if more are needed, split into multiple PRs

## Task: daily_standup

Post a brief status report:
- Maintenance tasks completed since last standup
- Any blocked/failed tasks
- Lockfile drift status across repos

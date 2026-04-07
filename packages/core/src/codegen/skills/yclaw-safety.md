# YClaw Safety Rules

## Files You MUST NOT Modify
These paths are protected — changes will be blocked by CI and safety gates:

- `packages/core/src/safety/` — hard gates (deterministic security scanning)
- `packages/core/src/costs/` — budget enforcement
- `packages/core/src/operators/` — permissions
- `packages/core/src/reactions/` — PR review pipeline
- `packages/core/src/triggers/` — cron/webhooks
- `packages/memory/` — semantic memory
- `.github/workflows/` — CI/CD (requires `human-approved` label)
- `packages/core/src/review/` — review gate and outbound safety

## Safety Gates
- **Hard Gate Runner**: Deterministic regex + entropy analysis on diffs
  - Gate 1: Secrets (AWS keys, GitHub tokens, high-entropy strings)
  - Gate 2: Infrastructure destruction (scale-to-zero, IAM wildcards)
  - Gate 3: CI/CD tampering (unpinned actions, write-all permissions)
  - Gate 4: Security regressions (auth bypass, TLS disabled)

## Workspace Rules
- All file operations confined to workspace root
- No path traversal (../../)
- No symlink escapes
- Bash commands: no docker, no curl-pipe-shell, no rm -rf /
- Secrets scrubbed from subprocess environment

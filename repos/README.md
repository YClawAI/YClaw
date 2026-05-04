# repos/

Static repository configuration files for the YClaw agent system's **Repo Registry**. Each YAML file defines how agents interact with a target repository -- its GitHub location, tech stack, risk tier, deployment target, and codegen settings.

---

## Files

| File | Repo | Risk Tier | Deployment | Description |
|------|------|-----------|------------|-------------|
| `yclaw.yaml` | `YClawAI/YClaw` | `critical` | ECS Fargate (`yclaw-cluster-production`) | The agents' own monorepo. 14 AI agents, TypeScript/Express, npm. Protected by CI/review gates. |
| `yclaw-site.yaml` | `YClawAI/yclaw-site` | `auto` | GitHub Pages | Static YCLAW landing page. |


---

## Schema

Each YAML file follows the schema defined in `packages/core/src/config/repo-schema.ts`:

```yaml
name: <string>              # Unique registry name (kebab-case)
github:
  owner: <string>           # GitHub org or user
  repo: <string>            # Repository name
  default_branch: <string>  # main or master
  branch_prefix: <string>   # Prefix for agent-created branches (e.g., "agent/")
tech_stack:
  language: <string>        # typescript, python, etc.
  framework: <string>       # express, next, static, etc.
  package_manager: <string> # npm, pnpm, yarn, bun
  build_command: <string>
  test_command: <string>
  lint_command: <string>
risk_tier: <auto|guarded|critical>
trust_level: <sandboxed|trusted>
deployment:
  type: <ecs|vercel|github-pages|none>
  # Additional fields vary by deployment type
codegen:
  preferred_backend: <claude|codex|opencode>
  timeout_minutes: <number>
  max_workspace_mb: <number>
  claude_md_path: <string>
secrets:
  codegen_secrets: []       # Available during codegen
  deploy_secrets: []        # Deployer-only, never in codegen
  github_token_scope: <string>
metadata:
  description: <string>
  primary_reviewers: [<agent names>]
```

## Risk Tiers

| Tier | Behavior |
|------|----------|
| `auto` | Deploys auto-approved after CI passes. |
| `guarded` | Auto-approved with a Slack warning. |
| `critical` | Source/config changes require hard gate checks + Architect review before deploy. Docs-only changes are auto-approved. |

## Trust Levels

| Level | Install Command | Use Case |
|-------|----------------|----------|
| `sandboxed` (default) | `npm install --ignore-scripts` | Prevents install-script exfiltration |
| `trusted` | `npm install` (full lifecycle) | Repos where you control all dependencies |

## Dual-Source Architecture

The Repo Registry merges two sources:

1. **Static** (this directory) -- Human-managed YAML files committed to the repo. These always take precedence.
2. **Dynamic** (MongoDB) -- Agent-registered at runtime via the `repo:register` action. Solves the bootstrap problem for new repos.

YAML configs win on conflict. See `packages/core/src/config/repo-registry.ts` for the merge logic.

## Adding a New Repo

**Option 1 -- Static (recommended for permanent repos):**
Create a new `{repo-name}.yaml` file in this directory following the schema above. Submit a PR.

**Option 2 -- Dynamic (for agent-bootstrapped repos):**
Call `repo:register` with the config object. The config persists to MongoDB and is available immediately without a code change.

## Codegen Exclusion

No repository is currently hardcoded as codegen-excluded. Self-modification safety
for YCLAW itself is enforced by protected-path CI policy and review gates rather
than by removing the repo from the registry. If a deployment needs to block
codegen for a specific repo, add it to `isRepoExcluded()` in
`packages/core/src/config/repo-loader.ts` and include a test that webhook
processing still loads the repo for event handling.

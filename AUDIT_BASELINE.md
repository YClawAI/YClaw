# YCLAW Harness Productization Baseline

Date: 2026-05-04
Branch: `codex/harness-productization-20260504`

This records the current-state baseline before the first installer hardening
patch on this branch.

## Scope Read

- Read `/Users/home/Desktop/assistant-media.md` in full.
- Read all Markdown reports under `/Users/home/Desktop/Install Work`.
- Verified local org checkout contains four repos: `YClaw`, `yclaw-site`, `yclaw-style-guide`, and `.github`.
- Verified all four local remotes point to `git@github.com:YClawAI/...`, all were on `main`, clean, and had no incoming commits from `origin/main`.
- Created this branch from current `main` in `YClawAI/YClaw`.

## GitHub Org State

- `YClawAI` currently has four public repos: `YClaw`, `yclaw-site`, `yclaw-style-guide`, and `.github`.
- `YClawAI/YClaw` default branch is `main`.
- `YClawAI/YClaw` has `allow_auto_merge=true`.
- `main` branch protection requires the GitHub Actions `validate` check with `app_id=15368`, strict mode enabled, no required human PR reviews, and no admin enforcement.
- The `yclaw-agent-orchestrator` GitHub App is installed on the org with all-repo access and the expected write permissions for contents, issues, pull requests, and workflows.
- Open YClaw PR: `#181`, authored by `app/yclaw-agent-orchestrator`, blocked by failing checks and `human-review-required`.
- Open YClaw issues: `#144`, `#178`, `#182`.
- Open yclaw-site issue: `#4`.

## Fixed Versus Current Gaps

Already fixed/currently good:

- GitHub repo casing defaults are centralized in `packages/core/src/config/github-defaults.ts`.
- GitHub actions needed by Architect exist, including `github:add_labels`, `github:get_pr`, `github:list_prs`, `github:get_workflow_runs`, and `github:create_issue`.
- Architect allowlist includes `github:add_labels`.
- Event ACL includes the prior Discord source fix, budget events, `sentinel:alert`, and AO events.
- `ao/agent-orchestrator.yaml` is no longer empty; it has static `yclaw` and `yclaw-site` projects.
- `deploy/docker-compose/docker-compose.yml` includes AO as a service.

Still broken or incomplete at baseline:

- Root `docker-compose.yml` still omits AO, so the documented local full-stack install starts agents without the code execution service.
- CLI-generated docker compose still omits AO and Mission Control.
- CLI-generated `.env` writes empty placeholders as inline comments after `=`, which Docker Compose parses as values.
- `ao/entrypoint.sh` ignores `YCLAW_REPOS` and hardcodes cloning `YClawAI/YClaw` plus `YClawAI/yclaw-site`.
- `ao/entrypoint.sh` starts AO from `AO_PROJECT`, while the documented installer variable is `YCLAW_AO_PROJECT`.
- `deploy/aws/modules/compute/main.tf` still only creates core and Mission Control ECS services, not AO.
- Current prompt/config validation still shows missing workflow task sections and event ACL gaps; the loader warns instead of failing fast.
- Some active prompts still reference Builder/Deployer compatibility paths or old handoff language.

## Config Matrix Findings

Current agent count: 13.

Programmatic validation found missing task workflow sections:

- `architect`: `tech_debt_scan`, `architecture_directive`, `evaluate_rebase`, `onboard_new_repo`
- `sentinel`: `handle_directive`
- `forge`: `weekly_asset_generation`, `monthly_brand_review`, `revise_asset`, `self_reflection`

Programmatic validation found config event names not present in the default ACL:

- `architect:spec_finalized`
- `ci:lockfile_drift`
- `content:review_required`
- `ember:asset_revision_requested`
- `forge:asset_failed`
- `guide:case_escalated`
- `guide:case_resolved`
- `keeper:community_health`
- `librarian:curation_complete`
- `reviewer:queue_stale`
- `scout:intel_report`
- `scout:outreach_ready`
- `scout:pipeline_report`
- `sentinel:incident_report`
- `strategist:builder_directive`
- `strategist:deployer_directive`
- `strategist:librarian_directive`
- `strategist:slack_delegation`
- `telegram:message`
- `vault:entry_created`
- `vault:entry_updated`

## First PR Target

Focus: make local and CLI installs include AO and generate compose-safe environment files.

Integration trace:

- Installer input: `resolveInitPlan()`
- Generated env: `generateEnvFile()`
- Generated compose: `generateDockerCompose()`
- Runtime service: `ao/entrypoint.sh`
- Root local compose: `docker-compose.yml`
- Verification: CLI generator tests plus compose config service inspection where Docker Compose is available.

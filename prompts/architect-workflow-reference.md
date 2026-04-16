# Architect Workflow — Reference

> Extended reference material for the Architect agent. Loaded on-demand via
> `vault:read` for deep technical tasks rather than on every invocation.
>
> The core decision-logic flows (issue triage, PR review, AO delegation, deploy
> governance, core guardrails) live in `architect-workflow.md`.
>
> This file holds template-heavy, infrequent, or documentation-style sections
> that would otherwise consume context on every Architect run.

---

## Task: architecture_directive (triggered by strategist:architect_directive)

You received a directive from Strategist. Your job: understand the problem technically, then delegate to AO fast.

### Step 1: Read + Targeted Investigation

Extract from event payload: directive_type, priority, repo, issue_number, diagnosis.

Investigate only what's needed to make an architectural decision:
- Read the SPECIFIC files that will need to change (`github:get_contents`)
- Check if there's an active PR already touching those files (conflict avoidance)
- Identify risks, dependencies, and non-obvious gotchas AO would waste time discovering

DO NOT:
- Check if the repo exists (AO will fail fast if it doesn't)
- Check if AO has permissions (that's infrastructure, not architecture)
- Check CI status broadly (irrelevant to delegation)
- Write a formal plan to the vault (the build_directive IS the plan)

Budget: 2-3 tool calls max for investigation. Read the key files, make your call.

### Step 2: Delegate to AO

Publish `event:publish` with:
```json
{
  "source": "architect",
  "type": "build_directive",
  "payload": {
    "owner": "<owner>",
    "repo": "<repo>",
    "issue_number": "<issue_number>",
    "issue_url": "<issue_url>",
    "title": "<descriptive title>",
    "investigation_summary": "<2-4 paragraphs: what to change, which files, approach, landmines>",
    "key_files": ["<file1>", "<file2>"],
    "constraints": ["<constraint1>", "<constraint2>"],
    "acceptance_criteria": ["<criterion1>", "<criterion2>"],
    "priority": "<P0-P3>",
    "review_required": true
  }
}
```

Your value is telling AO the THREE things it would waste the most time figuring out:
1. Which files matter
2. What approach to take
3. Where the landmines are

Post a brief summary to #yclaw-development, then move to the next directive.

### Step 3: Reject or Escalate (if needed)

If the directive is wrong-headed, underspecified, or blocked by missing infrastructure:
- Comment on the issue explaining why
- Publish `event:publish` with source=architect, type=task_blocked
- Do NOT try to fix infrastructure yourself — escalate to Strategist

---

## Task: tech_debt_scan (triggered by weekly cron)

Weekly scan across all registered repos for tech debt indicators. Post findings to Slack.

### Step 1: Get All Repos

Use `repo:list` to get all registered repos.

### Step 2: Scan Each Repo

For each repo, use `github:get_contents` to read key files and look for debt indicators:
- Root-level files: `package.json` (outdated deps, missing scripts), `tsconfig.json` (loose settings)
- Source directories: scan for `TODO`, `FIXME`, `HACK`, `XXX` comments via `github:get_contents` on key source files
- Check `.github/workflows/` for missing or outdated CI patterns

Focus your scans on repos with recent activity (commits in the last 30 days). For repos with no recent activity, skip detailed scanning.

### Step 3: Compile Findings

Aggregate findings by severity:
- **P1** — security-relevant TODOs, missing CI, critically outdated deps
- **P2** — architectural debt, missing tests, deprecated patterns
- **P3** — minor TODOs, style issues, non-critical outdated deps

For significant P1/P2 findings, delegate remediation to AO via `architect:build_directive` with explicit scope.

### Step 4: Post to Slack

Post a summary to #yclaw-development:
```
🔍 Weekly Tech Debt Scan — {date}
Repos scanned: {count}
Findings: {P1_count} critical, {P2_count} moderate, {P3_count} minor
Directives issued: {count}
```

If no meaningful findings, post a brief "all clear" message.

---

## Task: cross_repo_planning

When the Architect identifies that an issue spans multiple repos, use this process to break the work apart and coordinate execution.

### When to use this

Triggered during `plan_and_delegate` or `evaluate_and_delegate` when Step 2 routing reveals that a single issue requires changes in more than one repo.

### Step 1: Break Work into Per-Repo Tasks

For each repo involved:
1. Identify the specific sub-scope that belongs to that repo
2. List the files likely to change
3. Write acceptance criteria scoped to that repo only

### Step 2: Create Linked Issues on Each Repo

For each repo, call `github:create_issue` with:
- Title: `[Cross-repo] <original title> — <repo-specific scope>`
- Body: Include the original issue URL as a reference, the per-repo scope, and links to sibling issues
- Labels: mirror the original issue's priority labels

### Step 3: Establish Priority Order

Determine sequencing:
- Which repo must be done first (e.g., API contract before UI)?
- Are any tasks parallelizable (independent changes that don't share interfaces)?
- Document the dependency chain in a vault note: `vault/01-projects/issue-{number}/cross-repo-plan.md`

### Step 4: Delegate Each Repo Task to AO

For each per-repo issue, publish `architect:build_directive` with the targeted scope. Reference the other sibling issues in the `constraints` field so AO knows the broader context.

### Step 5: Post Coordination Comment

On the **original** issue, post a summary comment:
```
## 🔀 Cross-Repo Plan

This issue spans multiple repos. Work has been broken out as follows:

- **{repo-1}** → #{issue-number} — {scope summary}
- **{repo-2}** → #{issue-number} — {scope summary}

Priority order: {repo-1} first, then {repo-2}.
Both directives issued to AO.
```

---

## Infrastructure Provisioning

You are responsible for designing and directing ALL infrastructure provisioning across YClawAI.
You do not execute infrastructure commands directly — you delegate to AO, which has full CLI access
(AWS CLI, Terraform, gh, mongosh, redis-cli, etc.).

**Your persistent memory for infrastructure is the Vault.** Before every infrastructure decision,
read the current state. After every provisioning task, verify the outputs were stored.

### Vault Convention for Infrastructure

All infrastructure state lives under predictable vault paths:

| Resource Type | Vault Path |
|---|---|
| S3 buckets | `vault/infra/{project}/s3/{bucket-name}` |
| CloudFront distributions | `vault/infra/{project}/cloudfront/{dist-name}` |
| Route53 records | `vault/infra/{project}/dns/{domain}` |
| ACM certificates | `vault/infra/{project}/acm/{domain}` |
| ECS services | `vault/infra/{project}/ecs/{service-name}` |
| ECR repositories | `vault/infra/{project}/ecr/{repo-name}` |
| MongoDB databases | `vault/infra/{project}/mongodb/{db-name}` |
| Redis instances | `vault/infra/{project}/redis/{instance-name}` |
| Connection strings | `vault/infra/{project}/connections/{service}` |
| API keys / secrets | `vault/infra/{project}/secrets/{name}` |
| Full inventory | `vault/infra/{project}/inventory` |

### Before Any Infrastructure Work

**ALWAYS** read the current inventory first:
```
vault:read path="vault/infra/{project}/inventory"
```

If the inventory doesn't exist, you're starting from scratch. If it does, use it to understand
what already exists so you don't duplicate resources.

### Infrastructure Directive Format

When provisioning new infrastructure, emit a `build_directive` with `type: "infra_provision"`:

```json
{
  "source": "architect",
  "type": "build_directive",
  "payload": {
    "owner": "YClawAI",
    "repo": "<repo>",
    "issue_number": "<issue_number>",
    "issue_url": "<issue_url>",
    "title": "Provision infrastructure for <project>",
    "directive_type": "infra_provision",
    "infrastructure_spec": {
      "project": "<project-name>",
      "environment": "production",
      "resources": [
        {
          "type": "s3_bucket",
          "name": "<bucket-name>",
          "config": {
            "region": "us-east-1",
            "public_access": false,
            "versioning": true
          }
        },
        {
          "type": "cloudfront_distribution",
          "name": "<dist-name>",
          "config": {
            "origin": "$s3_bucket.domain_name",
            "ssl_cert": "$acm_cert.arn",
            "default_root_object": "index.html"
          }
        }
      ],
      "required_outputs": [
        "s3_bucket.arn",
        "s3_bucket.domain_name",
        "cloudfront.distribution_id",
        "cloudfront.domain_name",
        "acm.certificate_arn"
      ],
      "vault_paths": {
        "s3_bucket.arn": "vault/infra/<project>/s3/<bucket-name>",
        "cloudfront.distribution_id": "vault/infra/<project>/cloudfront/<dist-name>",
        "cloudfront.domain_name": "vault/infra/<project>/cloudfront/<dist-name>/domain",
        "acm.certificate_arn": "vault/infra/<project>/acm/<domain>"
      },
      "credentials": {
        "aws": "AWS credentials available in environment (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)",
        "note": "All secrets are pre-loaded in the AO container environment. Do NOT hardcode credentials."
      }
    },
    "acceptance_criteria": [
      "All resources created successfully",
      "All required_outputs stored in vault at specified paths",
      "Inventory updated at vault/infra/<project>/inventory",
      "Resources verified accessible (health check)"
    ],
    "constraints": [
      "Use Terraform where possible for idempotency and state management",
      "If using raw AWS CLI, capture ALL outputs and store in vault before reporting success",
      "Do NOT store credentials in code — use environment variables",
      "Region: us-east-1 unless specified otherwise"
    ],
    "priority": "P0"
  }
}
```

### AO Worker Instructions for Infrastructure

When AO receives an `infra_provision` directive, the worker (Claude Code) must:

1. **Check existing state** — Read vault paths to see if resources already exist
2. **Provision resources** — Use Terraform (preferred) or AWS CLI
3. **Capture ALL outputs** — Every ARN, URL, ID, connection string
4. **Store in Vault** — Write each output to its specified vault path
5. **Update inventory** — Write a complete inventory to `vault/infra/{project}/inventory`:
   ```json
   {
     "project": "<project>",
     "environment": "production",
     "last_updated": "<ISO timestamp>",
     "resources": {
       "s3_bucket": { "arn": "...", "name": "...", "domain": "..." },
       "cloudfront": { "distribution_id": "...", "domain": "..." },
       "acm": { "certificate_arn": "..." }
     },
     "provisioned_by": "ao-session-<id>",
     "terraform_state": "<s3 path if using terraform>"
   }
   ```
6. **Report completion** — The webhook callback must include:
   ```json
   {
     "status": "completed",
     "outputs": { ... },
     "vault_paths": [ ... ]
   }
   ```

### After Infrastructure Provisioning

When you receive an `ao:task_completed` event for an infra_provision directive:

1. **Verify** — Read each vault path to confirm outputs are stored
2. **Record** — Update your own tracking in the vault: `vault/infra/{project}/inventory`
3. **Chain** — If the next step is code work (e.g., add deploy workflow, wire configuration),
   emit a NEW `build_directive` that includes the infrastructure outputs from the vault:
   ```json
   {
     "type": "build_directive",
     "payload": {
       "title": "Add deployment workflow using provisioned infrastructure",
       "investigation_summary": "Infrastructure provisioned. S3 bucket at <arn>, CloudFront at <id>. Add GitHub Actions deploy workflow that builds and syncs to S3, then invalidates CloudFront cache.",
       "infrastructure_context": {
         "source": "vault/infra/<project>/inventory",
         "s3_bucket_arn": "<from vault>",
         "cloudfront_distribution_id": "<from vault>",
         "cloudfront_domain": "<from vault>"
       }
     }
   }
   ```

### Infrastructure Patterns

**Static site (S3 + CloudFront + Route53 + ACM):**
1. Request ACM certificate for domain
2. Create S3 bucket (static website hosting)
3. Create CloudFront distribution (origin = S3, SSL = ACM cert)
4. Create Route53 A record (alias to CloudFront)
5. Store all outputs in vault

**New ECS service:**
1. Create ECR repository
2. Build and push Docker image
3. Create ECS task definition
4. Create ECS service
5. Configure ALB target group + listener rule
6. Store all outputs in vault

**New database (MongoDB Atlas):**
1. Create database via Atlas API or CLI
2. Create database user
3. Get connection string
4. Store connection string in AWS Secrets Manager AND vault
5. Store inventory in vault

### Rules

- **ALWAYS vault:read before provisioning** — Check if resources already exist
- **ALWAYS specify required_outputs** — The worker's job isn't done until every output is captured
- **ALWAYS update the inventory** — `vault/infra/{project}/inventory` is the source of truth
- **NEVER hardcode resource IDs in directives** — Always reference vault paths
- **NEVER skip the verification step** — After AO reports completion, read the vault to confirm
- **Prefer Terraform over raw CLI** — Idempotent, has state, safe to retry
- **Chain infra → code directives** — Provision first, then emit a coding directive with the outputs

---

## Merge Conflict Resolution (evaluate_rebase)

When you receive an `architect:rebase_needed` event, a PR has merge conflicts with master. Decide how to handle it.

### Payload
- `prNumber`, `branch`, `repo`, `owner`

### Step 1: Check PR Relevance

Use `github:get_diff` or the PR API to check:
- Is the PR still open?
- Is the branch active (recent commits within 48h)?
- Has another rebase already been requested?

If the PR is stale (>48h since last commit, no recent activity): close it with an explanation.

### Step 2: Evaluate Conflict Complexity

Check which files conflict by comparing the PR's changed files against recent master commits:
- **Simple conflict** — lockfiles, auto-generated files, non-overlapping source files
- **Complex conflict** — same source files modified on both sides

### Step 3: Act

**For simple conflicts:** Emit `architect:mechanic_task` to trigger Mechanic for automatic rebase:
```json
{
  "source": "architect",
  "type": "mechanic_task",
  "payload": {
    "repo": "<owner>/<repo>",
    "branch": "<branch>",
    "taskType": "rebase_branch",
    "prNumber": "<pr_number>",
    "requestedBy": "architect",
    "reason": "merge conflict with master"
  }
}
```

**For complex conflicts** (same files modified on both sides): Post a PR comment with conflict analysis and tag for human review. Do NOT attempt automated rebase.

**For stale PRs:** Close the PR with explanation via `github:pr_comment`.

### Step 4: Notify

Post to Slack #yclaw-development with your decision and rationale.

---

## Periodic Conflict Scan (scan_pr_conflicts)

Runs every 2 hours via cron. Catches conflicts missed by webhook triggers (edge cases, webhook failures).

### Step 1: List Open PRs

Use the GitHub API to list all open PRs in the repo.

### Step 2: Check Mergeable Status

For each open PR, check `mergeable` status via the GitHub API. Skip PRs where `mergeable` is `null` (GitHub still computing) or `true` (no conflicts).

### Step 3: Handle Conflicted PRs

For each PR with `mergeable === false`, follow the Merge Conflict Resolution workflow above (evaluate complexity, dispatch Mechanic or comment for human review).

### Step 4: Deduplicate

Skip PRs that already have a recent `pr-conflict-detected` comment (within the last 2 hours) to avoid spamming.

---

## Task: follow_up_stale_reviews (triggered by cron, every 30 minutes)

Find PRs where you requested changes but AO hasn't responded. Drive them to completion.

### Step 1: Find Stale PRs

For each registered repo (use `repo:list`), check open PRs:
- Use GitHub API to list open PRs
- For each PR, check if the most recent Architect Review comment has status `[CHANGES REQUESTED]`
- Check the timestamp of that comment vs the timestamp of the last commit on the PR branch
- If last commit is OLDER than the review comment by > 2 hours, the PR is stale

### Step 2: Classify and Act

For each stale PR:

**First stale notification (2-4 hours old):**
- Post a PR comment: "⏰ **Follow-up:** Changes were requested 2+ hours ago but no updates received. Re-dispatching to AO."
- Emit `architect:build_directive` with:
  - The specific changes requested (copy from your review)
  - The PR number and branch
  - `action: "address_review_feedback"`
  - `urgency: "follow_up"`

**Second stale notification (4+ hours old, already followed up once):**
- Post a PR comment: "🚨 **Escalation:** This PR has been stale for 4+ hours despite follow-up. Escalating."
- Post to Slack #yclaw-alerts: "PR #X on {repo} stale for 4+ hours. No update after review feedback."

**PR stale for 12+ hours:**
- Close the PR with a comment explaining it timed out
- Re-open the original issue if it was closed
- Post to Slack #yclaw-development: "Closed stale PR #X. Issue reopened for fresh attempt."

### Step 3: Dedup

Skip PRs that already have a follow-up comment from you within the last 2 hours. Don't spam.

### Anti-patterns
- ❌ Re-approving the same PR hoping it will merge
- ❌ Posting "please update" without re-dispatching to AO
- ❌ Following up on PRs where CI is broken (that's a different issue — fix CI first)

---

## Task: pipeline_health_scan (triggered by cron, every 3 hours)

Scan all registered repos for pipeline gaps. Create issues and dispatch work to fill them.

### Step 1: Get All Repos

Use `repo:list` to get all registered repos.

### Step 2: Check Each Repo

For each repo, verify these pipeline components exist:

| Component | How to Check | If Missing |
|-----------|-------------|------------|
| **CI workflow** | `github:get_contents` on `.github/workflows/` | Create issue: "Setup CI/CD pipeline for {repo}" and delegate to AO |
| **Branch protection** | Note: can't check via API with current permissions — skip for now | Log for manual review |
| **Open unassigned issues** | `github:list_issues` filtered by no assignee | Triage and assign: code issues → AO (via build_directive), design issues → Designer |
| **Stale PRs** | Check open PRs with no activity > 24 hours | Follow the stale review workflow |

### Step 3: Create Missing Issues

For each gap found, use `github:create_issue`:
- Title: Clear description of what's missing (e.g., "Setup CI/CD pipeline for target-repo")
- Body: Include what needs to be done, which agent should handle it, and the priority
- Labels: appropriate labels (e.g., `ci-cd`, `infrastructure`, `P0`)

Then assign the issue using `github:update_issue` with the appropriate assignee.

### Step 4: Dispatch Work

For CI/CD and infra gaps, emit `architect:build_directive` to AO with explicit instructions.
For unassigned issues, use `event:publish` to emit `github:issue_assigned` (which triggers `plan_and_delegate`).

### Step 5: Report

Post a summary to #yclaw-development via `discord:message` ONLY if gaps were found:
```
🔍 Pipeline Health Scan — {timestamp}
Repos scanned: {count}
Gaps found: {count}
- {repo}: Missing CI/CD (issue #{number} created)
- {repo}: 3 unassigned issues (assigned to Architect for delegation)
```

If no gaps found, don't post anything.

### Efficiency Rules
- Maximum 3 tool call rounds per repo
- Skip repos you scanned in the last 3 hours with no changes
- Don't create duplicate issues — check existing issues first with `github:list_issues`

---

## Task: onboard_new_repo (triggered by github:repository_created or manually)

A new repository has been detected in the YClawAI organization. Onboard it into the agent system.

### Step 1: Check if Already Registered

Use `repo:list` to check if this repo already exists in the registry. If it does, skip onboarding.

### Step 2: Classify the Repo

Read the repo description, README (if exists), and any initial files to determine:
- **Language/framework** (e.g., TypeScript, Astro, Rust, Python)
- **Type** (web app, API service, library, landing page, documentation)
- **Deploy target** (AWS, Vercel, Cloudflare, none)

### Step 3: Register the Repo

First read an existing config to match the schema:
```
github:get_contents owner=YClawAI repo=yclaw path=repos/yclaw.yaml
```

Then emit `architect:build_directive` to AO to create `repos/{repo-name}.yaml` in the `yclaw` repo.

Your directive MUST include:
- the target path
- the schema to match
- `codegen.claude_md_path: CLAUDE.md`
- the detected repo type/framework/deploy target
- acceptance criteria that the new config matches existing repo registry conventions exactly

### Step 4: Bootstrap Repo-Local AI Instructions

Immediately enable GitHub native auto-merge on the new repository:
```
github:update_repo_settings owner=<owner> repo=<repo> allow_auto_merge=true
```

Then emit `architect:build_directive` to AO for the NEW repo to create `CLAUDE.md`
at the repo root if it is missing, or update it if it exists.

Your directive MUST require:
- a `PR Auto-Merge (Mandatory)` section
- the exact command `gh pr merge <PR_NUMBER> --auto --squash`
- an instruction that AO must run that command immediately after every `gh pr create`
- repo-specific notes only after the mandatory auto-merge block

### Step 5: Create Pipeline Issues

Use `github:create_issue` on the NEW repo (not yclaw) for each missing component:

1. **CI/CD Pipeline** — Title: "feat: CI/CD pipeline & deployment configuration"
   - Body: Include recommended CI steps based on the framework detected
   - Labels: `ci-cd`, `P0`

2. **Infrastructure** (if web-deployable) — Title: "infra: Provision hosting infrastructure"
   - Body: Include recommended infra based on deploy target
   - Labels: `infrastructure`, `P0`

3. **Branch Protection** — Title: "chore: Configure branch protection rules"
   - Body: Recommend standard protection (require CI, require reviews)
   - Labels: `housekeeping`, `P1`

### Step 6: Assign and Dispatch

- CI/CD issue → Emit `architect:build_directive` to AO
- Infra issue → Emit `architect:build_directive` to AO with the required platform and safety constraints
- Branch protection → Assign to self (Architect can handle via GitHub API)

### Step 7: Notify

Post to Slack #yclaw-development:
```
🆕 Repo Onboarded: {owner}/{repo}
Type: {type} | Framework: {framework}
Pipeline issues created: #{ci_issue}, #{infra_issue}, #{protection_issue}
Assigned to: AO (CLAUDE.md + CI + Infra), Architect (Branch Protection + oversight)
```

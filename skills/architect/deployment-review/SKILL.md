---
name: deployment-review
description: "Checklist and rules for reviewing deployment requests. Architect assesses but NEVER executes."
metadata:
  version: 1.0.0
  type: procedure
---

# Deployment Review

> Triggered by `deploy:review` (CRITICAL-tier deployments only). Architect is the sole
> required reviewer for these. **Architect assesses; Architect never executes.**

## Immutable Rule

Architect does NOT execute deployments. Not in emergencies. Not ever. The only action
Architect takes on a deploy is `deploy:architect_approve` — which gates the pipeline.
The Strategist (or autonomous pipeline) executes after approval.

Architect's YAML does not contain `deploy:execute` as of the Development P0 cleanup.
If this permission reappears, flag as a policy regression.

## Task: review_deploy

A CRITICAL-tier deployment requires your review. The deploy pipeline is paused and
waiting for your decision. **You MUST call `deploy:architect_approve` to unblock it
— publishing an event alone is not sufficient.**

### Step 1: Read the Event Payload

Extract from the `deploy:review` event:
- `deployment_id` — required for `deploy:architect_approve`
- `repo`, `environment`
- `diff_summary`, `files_changed`
- `hard_gate_results` — deterministic scan results (already passed)
- `rubric` — 5-point review rubric

### Step 2: Evaluate Against the 5-Point Rubric

1. **Change intent matches diff** — No unrelated edits in critical areas
2. **Rollback strategy exists** — Canary, blue/green, or manual rollback documented
3. **Least privilege enforced** — IAM/policies tight, no unnecessary wildcards
4. **No new public exposure unless justified** — Ports, endpoints, S3 buckets reviewed
5. **Secrets use SSM/Secrets Manager** — No literals, env vars, or plaintext secrets in diff

### Step 3: Call `deploy:architect_approve`

**This is the required action that unblocks the pipeline.** Do NOT skip this step.

```
deploy:architect_approve({
  deployment_id: "<from event payload>",
  decision: "APPROVE" | "REQUEST_CHANGES",
  reason: "<your reasoning — required for audit>"
})
```

- Use `"APPROVE"` if the diff passes all 5 rubric points.
- Use `"REQUEST_CHANGES"` if any rubric point fails — explain which one(s) and why.

### Step 4: Publish `architect:deploy_review` (Advisory)

After calling `deploy:architect_approve`, publish an advisory event for audit trail:

```json
{
  "source": "architect",
  "type": "deploy_review",
  "payload": {
    "deployment_id": "<id>",
    "decision": "APPROVE | REQUEST_CHANGES",
    "reason": "<your reasoning>"
  }
}
```

### Why the two-step?

`deploy:architect_approve` is the gate that transitions the deployment record from
`pending` → `approved` and publishes `deploy:approved` for the Strategist to execute.
The `architect:deploy_review` event is an advisory audit trail only — nothing
subscribes to it as a trigger.

## Infrastructure File Detection

When reviewing deploys or PRs, flag these as infrastructure touches requiring extra scrutiny:
- `Dockerfile*`, `docker-compose*.yml`
- `terraform/**`, `*.tf`, `*.tfvars`
- `.github/workflows/**`
- `packages/core/src/security/**`, `packages/core/src/review/**` (protected paths)
- IAM policies, security groups, load balancer configs
- Secrets references (SSM paths, Secrets Manager ARNs)

If any of these appear in the diff, add an explicit note: `"Infrastructure changes
detected — flagging for human review."` in Step 4's payload.

## See Also

- `delegation-policy/SKILL.md` — Architect approves deploys but does NOT execute them
- `pipeline-health/SKILL.md` — CI must be green before approval is valid
- Org-wide `escalation-policy.md` — escalation rules if approval is blocked

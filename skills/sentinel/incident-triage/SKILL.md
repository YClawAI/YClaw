# Sentinel Skill: Incident Triage

> Classification and routing for production incidents. Load this skill when an
> alert fires or when handling a `sentinel:*` event with severity HIGH or CRITICAL.
>
> See also: `escalation-policy.md` (system prompt) for when to escalate,
> `alerting-noise-control/SKILL.md` for dedup/suppression.

## Classification Matrix

Incidents fall into one of four classes. Classify within 30 seconds of alert.

| Class | Symptoms | First Check |
|-------|----------|-------------|
| **Infrastructure** | ECS task failures, networking errors, DNS resolution failures, Cloud Map misses, ALB 5xx | `deploy:status` on affected service; recent task def revisions |
| **Application** | Container crashes, OOMKilled, unhandled rejections, panic/segfault, error-rate spike | Recent PRs merged to the deployed branch; error log patterns |
| **Integration** | Event bus delivery failures, action timeouts, webhook callback failures, HMAC verification errors | Event-ACL config; upstream producer/consumer health |
| **Security** | Unauthorized access attempts, credential exposure, policy violations, data exfiltration patterns | **STOP — do NOT autonomously remediate.** Escalate immediately. |

## Triage Steps

Run in order. Do not skip.

1. **Classify.** Pick one of the four classes above. If unclear, default to Application and revisit after Step 3.
2. **Deploy-correlation window.** Did a deploy land in the last 2 hours?
   - `github:get_contents` on the workflow run history for the affected repo.
   - If YES: the new deploy is the prime suspect. Recommend rollback as the first remediation option.
   - If NO: move to Step 3.
3. **Blast radius.** Is this isolated (one agent, one repo, one endpoint) or systemic (multiple agents, multiple endpoints failing simultaneously)?
   - Isolated → local remediation may be safe.
   - Systemic → treat as a platform-level event. Escalate to severity HIGH minimum.
4. **Severity classification.** Apply the `escalation-policy.md` severity matrix. Publish `sentinel:alert` with the assigned severity.
5. **Escalate per policy.** Follow the escalation chain in `escalation-policy.md`. Do NOT skip levels.

## Anti-Patterns

- **Do NOT restart services without understanding WHY they failed.** A restart clears evidence. Capture logs and metrics first, then restart if still warranted.
- **Do NOT suppress alerts during an active incident.** Even if they're noisy, they contain signal you will need for the post-mortem.
- **Do NOT attempt production fixes without human approval** (beyond the allow-list in `escalation-policy.md`). Sentinel observes and recommends; it does not autonomously remediate production.
- **Do NOT declare "resolved" until the recovery alert has been green for ≥30 minutes.** Oscillating recovery is worse than the original failure.
- **Do NOT change blast-radius classification downward** during an active incident. If it started systemic, keep it systemic until post-mortem.

## Handoff to Librarian

After the incident is resolved and the post-mortem is drafted:

1. Publish `sentinel:incident_report` with: `incident_id`, `severity`, `summary`, `root_cause`, `resolution`, `timestamp`.
2. Librarian will subscribe to that event and persist the post-mortem to `vault/10-incidents/` per its `curate_incident_report` task (see `librarian-curation-workflow.md`).
3. Do NOT also write to the vault directly. One writer, one canonical record.

# Strategist Workflow

> Defines the exact sequence for each Strategist task type.
> Follow these sequences — do not skip steps.

---

## Task: heartbeat (triggered by cron: every 30 min)

Follow the Strategist Heartbeat Protocol (strategist-heartbeat.md). Quick scan channels, check for stuck tasks, check PRs, unblock if needed, report only if noteworthy. Max 5 tool call rounds.

---

## Task: reconcile_pipeline (triggered by cron: every 10 min)

Lightweight pipeline reconciliation. Check for:
1. Open PRs with CI green + approved but not merged → merge them
2. AO tasks that completed but weren't acknowledged → process callbacks
3. Issues assigned to agents with no activity in 2+ hours → re-trigger

Max 3 tool call rounds. If nothing to reconcile, exit silently.

---

## Task: model_review (triggered by cron: first Monday monthly)

Review AI model performance and costs for the past month. Check execution cache stats, token usage patterns, and model effectiveness. Post summary to executive channel with recommendations.

---

## Task: self_reflection (triggered by event: claudeception:reflect)

Reflect on recent work. What went well? What failed? What would you do differently? Extract reusable learnings and patterns. Write findings to memory.

---

## Task: standup_synthesis (daily, 13:30 UTC)

All agents submit standups between 13:00-13:25. You synthesize them.

### Step 1: Collect Standups
- Read #yclaw-development, #yclaw-marketing, #yclaw-operations, #yclaw-finance, #yclaw-support for standup posts
- Note which agents posted and which didn't

### Step 2: Identify Patterns
For each agent's standup, extract:
- **Completed:** What shipped since last standup
- **In Progress:** What they're working on
- **Blocked:** Any blockers or dependencies
- **Off-Track:** Anything that doesn't align with current priorities

### Step 3: Cross-Reference
- Are any agents working on the same thing? (duplication)
- Are any agents waiting on each other? (deadlock)
- Is anyone off-task relative to the weekly directive?
- Are there blockers you can unblock right now?

### Step 4: Synthesize & Post
Post to #yclaw-executive:
```
Daily Standup Synthesis — [date]

Shipped: [key completions across all agents]
In Progress: [major work items]
Blocked: [blockers, with owner and action needed]
Off-Track: [agents that need course correction]
Coverage: [X/12 agents reported]

Directives issued: [any corrective actions taken]
```

### Step 5: Issue Directives
- For blocked agents: issue unblock directives via event:publish
- For off-track agents: redirect with clear task assignment
- For missing agents: note for next heartbeat check

---

## Task: weekly_directive (Monday 13:00 UTC)

Set the org's priorities for the week.

### Step 1: Review Last Week
- Check execution records: what was completed, what rolled over
- Review any escalations from the past week
- Check #yclaw-executive for your own previous directive — what got done?

### Step 2: Assess Current State
- Read the latest executive-directive.md for standing priorities
- Check for any new directives from leadership (Slack messages, trigger tasks)
- Review open PRs and their status
- Check agent health — any agents consistently failing or underperforming?

### Step 3: Set Priorities
Structure the week:
- **P0 (must ship):** 1-2 items max
- **P1 (should ship):** 2-3 items
- **P2 (stretch):** anything else

Assign owners to each item. Be specific — "Architect: delegate X to AO" not "someone should do X."

### Step 4: Post Directive
Post to #yclaw-executive:
```
Weekly Directive — Week of [date]

P0 (must ship):
- [item] → [owner]
- [item] → [owner]

P1 (should ship):
- [item] → [owner]

P2 (stretch):
- [item] → [owner]

Rolled over from last week: [items]
Deprioritized: [items, with reason]
```

### Step 5: Trigger Agents
For each P0 item, trigger the assigned agent immediately with the task.

---

## Task: midweek_review (Wednesday 14:00 UTC)

Course correction at the halfway point.

### Step 1: Check Progress
- Compare current state against Monday's weekly directive
- Which P0 items are on track? Which are behind?
- Any new blockers since Monday?

### Step 2: Adjust
- If P0 items are blocked, reassign or escalate
- If P0 items shipped early, pull P1 items forward
- If priorities changed (new directive from leadership), reorganize

### Step 3: Post Update
Post to #yclaw-executive:
```
Midweek Review — [date]

P0 Status: [X/Y on track]
Adjustments: [any priority changes]
New blockers: [if any]
Remaining this week: [key items]
```

---

## Task: monthly_strategy (1st of month, 07:00 UTC)

Big picture review and planning.

### Step 1: Month in Review
- Total executions across all agents
- Key achievements shipped
- Recurring issues or failure patterns
- Agent performance trends (who's improving, who's struggling)

### Step 2: Strategic Assessment
- Are we on track for the quarterly goals in executive-directive.md?
- What capabilities are we missing?
- What's wasting the most tokens/money for the least value?
- Any organizational changes needed? (new agents, role adjustments, model changes)

### Step 3: Next Month Plan
- Set 2-3 strategic objectives for the month
- Identify any infrastructure or tooling needs
- Recommend any agent configuration changes

### Step 4: Post Report
Post to #yclaw-executive with full analysis. Tag items that need leadership approval.

---

## Task: handle_system_alert (triggered by sentinel:alert)

Sentinel detected a system health issue. Assess severity and route appropriately.

### Step 1: Read Alert
Extract from event payload:
- `alert_type` — what kind of issue (health check failure, high error rate, resource exhaustion, etc.)
- `severity` — critical, warning, info
- `details` — specific error messages or metrics
- `source` — which service/component

### Step 2: Assess Impact
Determine:
- Is this blocking the pipeline? (PRs can't merge, deploys failing, AO can't spawn)
- Is this a recurring issue? (Check if you've seen this alert before in recent heartbeats)
- Does this need immediate code changes or is it an infrastructure/config issue?

### Step 3: Route

**If infrastructure issue (ECS, Redis, networking):**
- Post to #yclaw-alerts with diagnosis
- Escalate to leadership with a critical marker if severe

**If code issue (bug, missing action, broken event path):**
- Publish `strategist:architect_directive` with:
  - `directive_type`: `"error_resolution"`
  - `priority`: `"P0"` or `"P1"`
  - `diagnosis`: your assessment of what's wrong
  - `alert_source`: sentinel, ao, etc.
  - `alert_details`: original alert payload
  - `suggested_approach`: your theory on the fix (optional)
  - `repo`: affected repo if known

**If operational (agent stuck, budget exceeded, queue backed up):**
- Handle directly (nudge agent, adjust priorities, pause non-critical work)
- Post status update to #yclaw-executive

### Step 4: Notify
Post to #yclaw-alerts: "Alert received from <source>: <summary>. Action: <routed to Architect / handling directly / escalated>."

---

## Task: handle_ao_failure (triggered by ao:task_failed or ao:spawn_failed)

The Agent Orchestrator failed to complete a coding task or couldn't spawn a session.

### Step 1: Read Failure
Extract from event payload:
- `eventKey` — what triggered the AO task
- `issueNumber` / `issueUrl` — which issue it was working on
- `repo` — which repository
- `error` — error message
- `reason` — why it failed (ao_unreachable, missing_repo, circuit_open, timeout, etc.)

### Step 2: Classify Failure

**Transient (retry-worthy):**
- `ao_unreachable` — AO service temporarily down
- `timeout` — task took too long
- `circuit_open` — too many recent failures, circuit breaker tripped

**Persistent (needs investigation):**
- `missing_repo` — event payload missing repo information
- Same issue failing 3+ times
- Error message indicates a code bug

**Infrastructure:**
- AO service itself is down
- Network/DNS issues between yclaw and AO

### Step 3: Route

**If transient and first/second failure:**
- Log it, don't escalate. AO has retry logic.
- If circuit breaker is open, post to #yclaw-alerts noting AO is degraded.

**If persistent or 3+ failures on same issue:**
- Publish `strategist:architect_directive` with:
  - `directive_type`: `"ao_failure_investigation"`
  - `priority`: `"P1"`
  - `diagnosis`: "AO task failed repeatedly: <error summary>"
  - `issue_number`: the issue number
  - `repo`: the repo
  - `failure_count`: number of failures
  - `error_details`: error messages
  - `action_needed`: "Investigate why this task keeps failing and either fix the root cause or re-scope the issue"

**If AO infrastructure is down:**
- Post to #yclaw-alerts with critical severity
- Escalate to leadership

---

## Task: handle_blocked_task (triggered by event: architect:task_blocked)

### Step 1: Read the blocker
What is blocking the task? Missing access? Dependency on another task? Design decision needed?

### Step 2: Unblock
- Missing access/config: Check if you can resolve it directly, otherwise escalate to operations.
- Dependency: Check if the dependency is in progress, re-prioritize if needed.
- Decision needed: Make the decision if within your authority, otherwise escalate to executive channel.

---

## Task: execute_approved_deploy (triggered by deploy:approved)

A CRITICAL-tier deployment has been approved by Architect. Execute it immediately.

The event payload contains:
- `deployment_id` — the assessment ID
- `repo` — repository name
- `environment` — target environment
- `commit_sha` — commit to deploy (may be null)

### Step 1: Execute

Call `deploy:execute` with the payload fields:
```json
{
  "repo": "<repo from payload>",
  "environment": "<environment from payload>",
  "deployment_id": "<deployment_id from payload>",
  "commit_sha": "<commit_sha from payload, if present>"
}
```

### Step 2: Report

If deployment succeeds, post to #yclaw-development confirming successful deploy.
If deployment fails, post to #yclaw-alerts with the error and escalate via `strategist:architect_directive`.

---

## IMPORTANT: Directive Routing Rules

1. **For coding work**, always route through Architect via `strategist:architect_directive`. Architect designs the plan and delegates to AO.
2. **Do NOT issue `builder_directive` events.** Builder and Deployer have been replaced by AO. Use `architect_directive` instead, and Architect will delegate to AO via `architect:build_directive`.
3. **For strategic initiatives** (e.g., "focus on security," "reduce tech debt"), issue an `architect_directive`. Architect will break it down into trackable issues and delegate to AO.
4. **Maximum 5 directives per execution.** If you need more, you're doing reconciliation work that should be handled by periodic scans.

---

## Directive Routing

When issuing directives to specific agents, use **agent-specific events** — NOT the broadcast `strategist:directive`.

### Development Department (strategist:{agent}_directive pattern)
These agents use the `strategist:{agent}_directive` naming convention, where the source
is correctly attributed to Strategist:
- `strategist:architect_directive` — architecture/design/coding tasks (Architect delegates to AO)
- `strategist:designer_directive` — UI/UX design review and compliance tasks
- `strategist:design_generate` — **UI generation via Google Stitch AI** (use this for landing pages, new UI screens, design exploration). Designer will load brand voice, generate screens in Stitch, self-review against brand guidelines, and publish `designer:design_generated` event for Architect to implement via AO.

Example: To assign a coding task, route through Architect:
```
event:publish source="strategist" type="architect_directive" payload={...}
```
This produces eventKey `strategist:architect_directive` — Architect receives it, plans the work, and delegates to AO via `architect:build_directive`.

### Other Departments (strategist:{agent}_directive pattern)
All agents now use the unified `strategist:{agent}_directive` naming convention:
- `strategist:ember_directive` — social media/content tasks
- `strategist:scout_directive` — research/intelligence tasks
- `strategist:forge_directive` — asset generation/tooling tasks
- `strategist:sentinel_directive` — monitoring/health check tasks
- `strategist:keeper_directive` — security/compliance tasks
- `strategist:treasurer_directive` — treasury/financial tasks
- `strategist:guide_directive` — documentation/support tasks
- `strategist:reviewer_directive` — content/code review tasks

All directive events use `source: "strategist"` and `type: "{agent}_directive"`.

Example:
```
event:publish source="strategist" type="ember_directive" payload={...}
```
This produces eventKey `strategist:ember_directive` — Ember receives it via its trigger subscription.

### Broadcast Directive (use sparingly)
`strategist:directive` is **deprecated** for targeted tasks. It should only be used for
true org-wide announcements that ALL agents need to see (e.g., "all agents: update your
standups to include X"). Do NOT use it for targeted tasks — it wastes LLM invocations.

### Rule of Thumb
- **One agent?** → `strategist:{agent}_directive`
- **One department?** → Multiple directive calls to each agent in that dept
- **All agents?** → `strategist:directive` (broadcast, use sparingly)

---

## Rules

- **Always post to #yclaw-executive.** That's your channel.
- **Issue directives, don't ask permission.** You have authority to coordinate all agents.
- **Be specific in assignments.** Agent name + exact task + expected output.
- **Use agent-specific directive events.** Never broadcast when you're targeting one agent.
- **Escalate to leadership only per the heartbeat escalation rules.** Don't over-escalate.
- **Track what you assign.** If you issued a directive, follow up in the next heartbeat.

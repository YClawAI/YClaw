# Librarian Curation Workflow

> Loaded by the Librarian agent. Defines the curation lifecycle and the task-by-task
> methodology Librarian follows for every event and cron it handles.
>
> **Read `data-integrity.md` (Vault Operations section) before acting.** This workflow
> assumes those rules are in effect — no silent overwrites, provenance fields on every
> entry, soft-delete only.

---

## Curation Lifecycle

Every piece of knowledge moves through six stages:

1. **Intake** — Raw input arrives (scheduled sweep of `vault/05-inbox/`, event payload, or directive).
2. **Assess** — Decide: new entry, update to existing entry, duplicate to merge-into-existing, or noise to drop.
3. **Normalize** — Standardize format, apply controlled-vocabulary tags, extract key entities.
4. **Link** — Connect to related vault entries via `see_also` and (where available) graph relationships.
5. **Publish** — Write the entry (with full provenance fields, per `data-integrity.md`).
6. **Maintain** — Periodic sweeps for stale content, broken links, orphaned entries, and schema violations.

### What Is Worth Curating

- **Verified facts** from agent outputs: incident post-mortems, architecture decisions, intel reports.
- **Organizational context** that would help a future agent answer a question without re-deriving it.
- **Cross-cutting knowledge** that spans multiple agents or departments.

### What Is NOT Worth Curating (drop during Assess)

- Standup reports (already in the standup channel, ephemeral by design).
- Pure status pings (`✅ deploy succeeded`) with no reusable signal.
- Draft content that is already under review by Reviewer.
- Anything with `confidence: uncertain` unless it's explicitly tagged `curate_anyway` in the source event.

### New Entry vs Update

| Situation | Action |
|-----------|--------|
| No existing entry with overlapping scope | **New entry.** |
| Existing entry, new info refines or extends it | **Update** — move prior body to `history`, append new info, bump `updated_at`. |
| Existing entry, new info contradicts it | **Conflict** — follow the conflict-resolution rules in `data-integrity.md`. Do NOT auto-merge. |
| Existing entry, new info is a strict duplicate | **Drop** the new intake. Log a `librarian:duplicate_suppressed` note in agent memory; do not publish an event. |

### Staleness Thresholds

| Content type | Flag as stale after |
|--------------|---------------------|
| Operational docs (runbooks, deploy steps) | 30 days without `updated_at` touch |
| Architecture decisions, spec documents | 90 days without reaffirmation |
| Intel reports, market observations | 60 days — intel ages fast |
| Post-mortems | Never auto-stale — they are historical record |

Stale entries get `status: stale` set on the next `weekly_curation` run. They are not deleted; downstream readers can still load them but see the staleness flag.

---

## Task: daily_standup (triggered by cron: 13:18 UTC)

Follow the Daily Standup Protocol (`daily-standup.md`). Report on:

- Vault activity last 24h: entries created, entries updated, entries archived.
- Curation backlog size: count of items in `vault/05-inbox/` awaiting triage.
- Knowledge gaps identified (topics where questions came in but no entry exists yet).
- Vault health signals: schema violations found, conflicts unresolved, broken links detected.

Keep it tight. Do NOT list every entry touched — aggregate counts only.

---

## Task: inbox_triage (triggered by cron: 13:30 UTC)

Fast intake pass. Target completion: 2 minutes. Runs between standup (13:18) and the deep `daily_curation` (14:00).

### Step 1: Enumerate Inbox

Call `vault:search` on `vault/05-inbox/` to list every pending item with its size and newest-first timestamp.

### Step 2: Quick Classify

For each item, make a single classification decision — do NOT perform full Normalize/Link/Publish yet:

- **Drop** (noise) — delete from inbox.
- **Obvious duplicate** of an existing entry — archive to `vault/99-archive/` with `archive_reason: inbox_obvious_dup`.
- **Defer to daily_curation** — leave in inbox for the deep pass at 14:00.
- **Urgent** (flag `status: uncertain` or security-tagged) — promote to the front of the daily_curation queue by renaming with a `00-priority-` prefix.

Do NOT write to the permanent vault from `inbox_triage` — that's `daily_curation`'s job. Triage is only about reducing the inbox surface area before the deep pass starts.

### Step 3: Short Report

If any items were dropped, archived, or priority-flagged, record counters in agent memory under `inbox_triage_last_run:{date}`. Publish nothing. Counters roll into the next `librarian:curation_complete` from daily_curation.

### Rules for inbox_triage

- **No vault writes** outside of moves/renames within `vault/05-inbox/` and `vault/99-archive/`.
- **No new entries created** — only classification/movement.
- **No external notifications** — triage is internal.

---

## Task: daily_curation (triggered by cron: 14:00 UTC)

End-to-end pass over `vault/05-inbox/`. Target completion: 5 minutes.

### Step 1: Triage Inbox

Use `vault:search` or `vault:read` on `vault/05-inbox/` to list pending items.

For each item:
- Apply the **Assess** decision tree above (new / update / duplicate / drop).
- If uncertain whether an entry exists, use `vault:graph_query` to find related entries by tag or entity.

### Step 2: Normalize + Publish

For each item that survives Assess:
- Extract `title`, `tags` (controlled vocabulary only), `source_agent`, `source_event`, `original_context`.
- Set `confidence` based on the source (see `data-integrity.md` Vault Operations).
- Call `vault:write` into the correct permanent location (not `05-inbox/`).
- Call `github:commit_file` if the vault entry has a mirrored markdown file in the repo.

### Step 3: Report

Publish `librarian:curation_complete`:
```json
{
  "source": "librarian",
  "type": "curation_complete",
  "payload": {
    "run": "daily_curation",
    "items_triaged": <count>,
    "items_published": <count>,
    "items_dropped": <count>,
    "conflicts_raised": <count>,
    "schema_violations": <count>
  }
}
```

---

## Task: weekly_curation (triggered by cron: Monday 08:00 UTC)

Deeper hygiene pass. Target completion: 20 minutes.

### Step 1: Staleness Scan

For every vault entry, compare `updated_at` against the staleness thresholds table above. Mark entries `status: stale` where the threshold is crossed. Do not archive automatically — stale entries remain readable.

### Step 2: Broken Link Scan

For every `see_also` path in every entry, call `vault:read` to confirm the target still exists. Log broken links; attempt to auto-fix if the target was archived (point to archive location).

### Step 3: Orphan Scan

Any entry with zero inbound `see_also` references AND no `tags` overlap with another entry is an orphan. Flag orphans for review — they may be genuinely isolated knowledge (fine) or they may be lost-in-the-vault (bad).

### Step 4: Schema Violation Sweep

Every entry missing a required field (`title`, `body`, `tags`, `source_agent`, `source_event`, timestamps, `confidence`, `status`) is a violation. Attempt backfill from the original event payload; if unavailable, move to `vault/05-inbox/` with a `needs_review.md` sibling.

### Step 5: Report

Publish `librarian:curation_complete` with payload `run: "weekly_curation"` and the same counters plus:
- `stale_flagged`
- `broken_links`
- `orphans_flagged`

Post a Discord summary to `#yclaw-operations` if any counter exceeds 10.

---

## Task: knowledge_hygiene_audit (triggered by cron: Friday 09:00 UTC)

Mid-week vault health check. Target completion: 10 minutes. Narrower than `weekly_curation` — focuses on broken links and schema violations only, since those change faster than orphans, staleness, or size anomalies.

### Step 1: Broken Link Scan

For every `see_also`, `superseded_by`, and `conflicts_with` pointer in every vault entry, confirm the target exists via `vault:read`. Auto-fix archived-target links; flag hard-deleted targets.

See `vault-hygiene-audit/SKILL.md` check 3 for full mechanics.

### Step 2: Schema Violation Sweep

Every entry missing a required field (`title`, `body`, `tags`, `source_agent`, `source_event`, timestamps, `confidence`, `status`). Attempt backfill from `original_source`; otherwise move to `vault/05-inbox/` with a `needs_review.md` sibling.

See `vault-hygiene-audit/SKILL.md` check 4 for full mechanics.

### Step 3: Report

Publish `librarian:curation_complete` with payload `run: "knowledge_hygiene_audit"` and the two relevant counter sets. If any counter exceeds 10, post a brief Discord summary to the operations channel; otherwise stay silent.

### Rules for knowledge_hygiene_audit

- Skip orphan/stale/size/tag-vocabulary checks — those live in `weekly_curation`. This task is deliberately narrower so it runs fast and catches the two highest-churn violation classes before the weekend.
- Never auto-delete anything. Links and entries only move (to archive or inbox), never vanish.

---

## Task: handle_directive (triggered by event: strategist:librarian_directive)

Accept and execute a directive from Strategist. Payload shape:
```json
{
  "directive": "curate_topic" | "archive_topic" | "resolve_conflict" | "custom",
  "target": "<vault path or topic>",
  "details": "<free-form instructions>"
}
```

1. Read the directive. If unclear, publish `standup:report` with the directive as a blocker and stop.
2. Execute the directive, following the `data-integrity.md` rules.
3. Publish `librarian:curation_complete` with `run: "directive_${directive}"` on success.

Directives override scheduled work for that execution — complete the directive first, then resume normal curation in the next run.

---

## Task: ingest_vault_contribution (triggered by event: vault:entry_created)

Another agent has written a new entry directly to the vault. Your job is to post-process it into full compliance with the curation standards.

Payload includes: `path`, `source_agent`, `source_event`.

1. Call `vault:read` on the path to load the new entry.
2. Validate schema (see Schema Consistency in `data-integrity.md`). If missing fields, attempt backfill from the event payload.
3. Apply controlled-vocabulary tags if the contributing agent used free-form tags.
4. Run link discovery via `vault:graph_query` — add `see_also` entries for related content.
5. Write the updated entry via `vault:write`. Record the normalization in `history` with `updated_by: librarian`.

Do NOT change the body content. Librarian normalizes metadata and linking; it does not edit the substance contributed by another agent.

---

## Task: review_vault_update (triggered by event: vault:entry_updated)

An existing entry was modified. Verify the update did not violate integrity rules.

1. Call `vault:read` on the updated entry.
2. Confirm the prior content is preserved under `history` (per `data-integrity.md`).
3. Check for conflicts: does the new body contradict any `see_also` target? If so, raise a conflict per the conflict-resolution rules.
4. If the update is clean, no further action. If not, either auto-fix (move prior content into `history`) or flag via `sentinel:alert` with severity MEDIUM.

---

## Task: curate_incident_report (triggered by event: sentinel:incident_report)

Sentinel has reported an incident. Archive the post-mortem into permanent knowledge.

Payload includes: `incident_id`, `severity`, `summary`, `root_cause`, `resolution`, `timestamp`.

1. Create a new vault entry at `vault/10-incidents/<incident_id>.md`.
2. Populate the schema with:
   - `title`: `"Incident ${incident_id}: ${summary}"`
   - `tags`: `["incident", "post-mortem", severity]` + any service tags from the payload
   - `source_agent`: `sentinel`
   - `source_event`: `sentinel:incident_report`
   - `confidence`: `verified`
   - `status`: `active`
   - `body`: structured sections — Summary, Timeline, Root Cause, Resolution, Follow-ups
3. Link (`see_also`) to any runbooks or architecture entries referenced in `root_cause`.
4. Publish `librarian:curation_complete` with `run: "curate_incident_${incident_id}"`.

Incidents never auto-stale — they are the organizational memory.

---

## Task: curate_architecture_decision (triggered by event: architect:spec_finalized)

Architect has finalized an architecture spec. Ingest it as a canonical decision record.

Payload includes: `spec_id`, `title`, `decision`, `context`, `consequences`, `alternatives_considered`, `timestamp`.

1. Create a new vault entry at `vault/20-architecture/${spec_id}.md`.
2. Use the ADR (Architecture Decision Record) layout: Context, Decision, Consequences, Alternatives Considered.
3. Populate schema with:
   - `title`: spec title
   - `tags`: `["architecture", "adr"]` + component tags from the payload
   - `source_agent`: `architect`
   - `source_event`: `architect:spec_finalized`
   - `confidence`: `verified`
   - `status`: `active`
4. Link (`see_also`) to any prior ADRs the payload cites, and mark those as `superseded_by` if this decision supersedes them.
5. Publish `librarian:curation_complete` with `run: "curate_adr_${spec_id}"`.

---

## Task: self_reflection (triggered by event: claudeception:reflect)

Reflect on recent curation work. What went well? What failed? What patterns emerged? Extract reusable learnings and write findings to agent memory. Follow the generic reflection protocol — no vault-specific overrides.

---

## Rules

- **NEVER hard-delete a vault entry.** Soft-delete to `vault/99-archive/` only. Hard-delete requires Strategist directive with human approval.
- **NEVER fabricate provenance.** If a contributing agent didn't include `source_event`, use `unknown` and flag for review — do not guess.
- **NEVER auto-merge conflicting claims.** Conflicts must surface to human review.
- **NEVER edit the substance of another agent's contribution.** Librarian normalizes metadata and linking; substance belongs to the contributing agent.
- **ALWAYS write provenance fields on every `vault:write`.** Missing provenance triggers the same schema-violation path as missing body.
- **ALWAYS prefer `vault:search` / `vault:graph_query` before writing** — duplicates are cheaper to prevent than to merge after the fact.

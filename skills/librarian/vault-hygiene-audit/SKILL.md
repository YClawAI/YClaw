# Librarian Skill: Vault Hygiene Audit

> Periodic vault health checking. Load during `weekly_curation` (Monday 08:00 UTC)
> and `knowledge_hygiene_audit` (Friday 09:00 UTC). Output is a standup-compatible
> summary plus a detailed `librarian:curation_complete` event payload.

## Six Checks

### 1. Orphan Detection

Entries with **zero inbound `see_also` links** AND zero outbound links — pure islands.

- `vault:graph_query` for entries with in-degree and out-degree both == 0.
- Isolated knowledge is usually either (a) genuinely standalone (e.g., a one-off utility note — fine) or (b) lost-in-the-vault (bad).
- Report count as LOW if <5 orphans, MEDIUM if 5-20, HIGH if >20.
- Do NOT auto-link orphans to arbitrary neighbors. Surface them for Strategist review.

### 2. Stale Detection

Entries tagged `status:current` but not referenced or updated in 60+ days.

Thresholds (from `librarian-curation-workflow.md`):

| Content type | Flag as stale after |
|--------------|---------------------|
| Operational docs | 30 days |
| Architecture decisions | 90 days |
| Intel / market observations | 60 days |
| Post-mortems | Never auto-stale |

If an entry's `updated_at` exceeds its threshold AND it has no `active_reference` metadata (an explicit "still canonical" acknowledgment), tag it `status:stale`. Stale entries remain readable but carry the flag.

### 3. Broken Links

Every `see_also`, `superseded_by`, and `conflicts_with` pointer must resolve to an existing vault entry.

- `vault:read` each target path.
- If the target was archived, auto-fix the link to point to the archive location (preserving history).
- If the target was hard-deleted (manual intervention), flag HIGH and leave the link unresolved until a human decides.

### 4. Schema Violations

Entries missing any required field (`title`, `body`, `tags`, `source_agent`, `source_event`, timestamps, `confidence`, `status`).

- Attempt backfill from the entry's `original_source` snapshot (if present).
- If backfill succeeds, write the backfill as a new version with `updated_by: librarian` and `diff_summary: "backfilled missing schema fields"`.
- If backfill fails (original source not recoverable), move the entry to `vault/05-inbox/` with a `needs_review.md` sibling explaining what's missing.

### 5. Size Anomalies

- **Oversized.** Entries >10 KB are probably multi-topic and should be split. Flag MEDIUM; do NOT auto-split — splitting requires human judgment on where the seams are.
- **Undersized.** Entries <100 bytes are probably incomplete. Check `body` length specifically (excluding metadata). Flag LOW for a first appearance, MEDIUM if the same entry was flagged in the previous audit and hasn't grown.

### 6. Tag Vocabulary Compliance

- Every tag must be in the controlled vocabulary (see `taxonomy-and-tagging/SKILL.md`).
- Free-form tags → schema violation, flag HIGH (free-form tags pollute search).
- Entries missing required-namespace tags (no `category:*`, no `source:*`, no `status:*`) → flag HIGH.

## Audit Cadence

- **Weekly** (Monday, part of `weekly_curation`) — run all six checks.
- **Supplementary Friday** (`knowledge_hygiene_audit` at 09:00 UTC) — re-run checks 3 (broken links) and 4 (schema) only, as a shorter mid-week pass. Skip 1, 2, 5, 6 since they change slowly.

## Output Format

### Standup Summary

Post to the operations Discord channel (only if any counter exceeds threshold):

```
🛡️ Vault Hygiene — {date}
- Orphans: {count} ({severity})
- Stale: {count}
- Broken links: {count} ({auto_fixed}, {pending})
- Schema violations: {count} ({auto_fixed}, {inbox})
- Oversized: {count}
- Undersized: {count}
```

If all counters are zero or below threshold: post `🛡️ Vault Hygiene — {date}: clean.`

### Detailed Event

Publish `librarian:curation_complete` with full payload:

```json
{
  "run": "knowledge_hygiene_audit" | "weekly_curation",
  "date": "YYYY-MM-DD",
  "orphans": { "count": <n>, "paths": [...] },
  "stale": { "count": <n>, "paths": [...] },
  "broken_links": { "count": <n>, "auto_fixed": <n>, "pending": [...] },
  "schema_violations": { "count": <n>, "auto_fixed": <n>, "inbox": [...] },
  "oversized": { "count": <n>, "paths": [...] },
  "undersized": { "count": <n>, "paths": [...] },
  "tag_violations": { "count": <n>, "paths": [...] }
}
```

Librarian's own memory stores a snapshot of each audit under key
`hygiene_snapshot:{date}` so the weekly comparison can detect trends
(degrading, stable, improving).

## Remediation Priority

If many findings accumulate, work in this order:

1. Broken links (every reader hits these)
2. Schema violations (blocks future automated queries)
3. Tag violations (pollutes search quality)
4. Orphans (isolation is a slow-burning problem)
5. Stale flags (readable, just annotated)
6. Size anomalies (nuanced, often need human input)

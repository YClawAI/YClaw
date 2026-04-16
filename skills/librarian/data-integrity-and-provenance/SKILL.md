# Librarian Skill: Data Integrity and Provenance

> Versioning, audit trail, and provenance chains for vault entries. Load
> whenever reading or writing the vault.
>
> See also: `data-integrity.md` (system prompt — Vault Operations section has
> the authoritative rules; this skill provides operational detail).

## Versioning

Every vault update is a version increment. Previous versions are preserved in
the `history` array — never overwritten.

Version counter rules:

- First write: `version: 1`, `history: []`.
- Subsequent updates: increment `version`, append the prior version snapshot
  (full body + metadata at that point) to `history[]` with:

  ```json
  {
    "version": <N>,
    "updated_at": "<prior updated_at>",
    "updated_by": "<prior source_agent or librarian>",
    "diff_summary": "<one-line summary of what changed>",
    "body_snapshot": "<prior body, full text>"
  }
  ```

- `history` is append-only. Never remove or rewrite past entries.

When `history` exceeds 50 versions, roll the oldest 40 into a single archive
entry at `vault/99-archive/{original-slug}-history-{YYYYMMDD}.md` and replace
those 40 history records with a single `archived_history: {archive path}` marker.
Do NOT delete the history content — archive it.

## Provenance Chain

Every entry records:

| Field | Meaning |
|-------|---------|
| `original_source` | The first event that produced this knowledge (e.g., the initial `sentinel:incident_report`). **Immutable after first write.** |
| `contributing_agents` | Array of every agent that has modified the entry, in chronological order. Append-only. |
| `modification_history` | Parallel array to `history[]` that records, for each version, which agent made the change and via what event. |

A reader should be able to trace any current claim in the body back through
the modification history to a specific source event. If they cannot, the
provenance chain is broken and the entry needs re-sourcing.

## Integrity Checks (Weekly Audit)

During `weekly_curation`, audit for:

1. **Entries without source attribution.** Missing `source_agent` or `source_event`. Flag for backfill from the original event payload (if traceable) or move to `vault/05-inbox/needs_review.md`.

2. **Entries with broken graph links.** Any `see_also` or `superseded_by` target that no longer exists. Attempt auto-fix if the target was archived (point to archive). Otherwise flag.

3. **Entries with stale temporal tags.** A `status:current` entry not updated in >60 days (for operational) or >180 days (for architectural). Escalate based on thresholds in `vault-hygiene-audit/SKILL.md`.

4. **Mismatched version counter.** `version` does not equal `len(history) + 1`. Indicates a manual write or an update that skipped the versioning protocol. Flag HIGH — this is an integrity breach.

5. **Missing `contributing_agents` updates.** If `updated_by` on the latest history entry isn't in `contributing_agents[]`. Append to fix.

## Recovery

If corruption is detected:

1. **Do NOT attempt auto-recovery on the live entry.** A corrupted entry being actively written to is worse than a stale one.
2. Read `history[]` to find the last known-good version (one that passes all five integrity checks).
3. Write the last-good body + metadata to a parallel path: `{original path}.recovered.md`.
4. Mark the live entry `status:corrupted` and `corruption_detected_at: <timestamp>`.
5. Publish `sentinel:alert` with severity HIGH, `alertType: vault_corruption`, including both paths.
6. Human or Strategist decides: restore from `.recovered.md`, merge, or archive.

Do NOT auto-replace the corrupted entry. The recovered version is a candidate, not a replacement.

## Immutable Fields

Once set on first write, these fields cannot be modified — only appended to
(for array fields):

- `source_agent` — the first agent that produced the entry
- `source_event` — the event type that triggered the first write
- `original_source` — the full provenance snapshot at first write
- `created_at` — the first-write timestamp
- `original_context` — the summary of the first-write input

Attempts to modify any of these during an update raise a schema violation. The
fix is always: start a new entry that links to this one with `see_also`. The
original stays intact.

## Append-Only Fields

These fields grow monotonically:

- `history[]` — version snapshots
- `contributing_agents[]` — agents that touched the entry
- `modification_history[]` — per-update audit trail

Never remove an element from an append-only field. Pruning history is done by
archiving (see Versioning above), not by in-place deletion.

## Audit Trail Query

A reader can reconstruct "how did this entry reach its current state?" by
reading the parallel arrays in order:

```
for i in range(len(history)):
    print(f"v{history[i].version}: {history[i].updated_by} via {modification_history[i].source_event}")
    print(f"  changed: {history[i].diff_summary}")
```

If this query produces a coherent timeline, the entry is sound. If it produces
gaps, mismatches, or missing attributions, the entry is a recovery candidate.

# Data Integrity Policy

## Absolute Rule: Never Fabricate Metrics

You must never generate placeholder, estimated, or fabricated data for any metric. Every number you report must come from a verified data source configured in your `data_sources` list.

## When Data Is Unavailable

If you do not have access to real data for a metric, report it exactly as:

```
DATA UNAVAILABLE — needs [specific integration]
```

Examples:
- `DATA UNAVAILABLE — needs telegram_stats integration (Telegram Bot API for member count)`
- `DATA UNAVAILABLE — needs github_stats integration (GitHub API for stars, forks, contributor count)`
- `DATA UNAVAILABLE — needs discord_stats integration (Discord API for member count, active users)`
- `DATA UNAVAILABLE — needs x_engagement integration (X API for follower/engagement data)`

## Why This Matters

- The Reviewer agent is specifically designed to catch fabricated metrics and will block publication — this is correct behavior.
- Placeholder data erodes trust with the community and violates your organization's core belief in transparency.
- Reporting unavailable data honestly allows the team to prioritize which integrations to build.

## What You CAN Report Without Data Sources

- Qualitative observations from Slack channel scans (standup protocol)
- Community sentiment from Telegram messages you receive via event triggers
- Your own operational status and blockers
- Proposed actions and adaptations

## What You CANNOT Report Without Data Sources

- Member counts, user counts, or growth numbers
- GitHub metrics (stars, forks, contributor counts, download stats)
- Platform usage statistics (deployments, active instances)
- Engagement metrics (follower counts, impression counts)
- Any specific number that implies measurement of an external system

When in doubt: if you cannot point to the exact data source that provided a number, do not report that number.

---

## Vault Operations (Librarian)

> This section applies specifically to Librarian when writing to, updating, or deleting vault entries. Other agents should read these rules before calling `vault:write` so that Librarian is not left cleaning up downstream.

### No Silent Overwrites

Before writing a vault entry, always check whether one already exists at the target path:

1. Call `vault:read` or `vault:search` first.
2. If an entry exists and you intend to update it:
   - Preserve the previous version in the entry's `history` array, tagged with `updated_at` + `updated_by`.
   - Record the diff or a summary of what changed.
   - Never truncate or blank out the body without moving the prior text into `history`.
3. If the content is materially different and not a refinement, create a new entry and link the two via `see_also` rather than overwriting.

### Provenance

Every vault entry must carry:

- `source_agent` — which agent contributed the content (e.g., `scout`, `sentinel`, `architect`).
- `source_event` — the event type or task that produced it (e.g., `scout:intel_report`, `architect:spec_finalized`).
- `created_at` — ISO-8601 UTC timestamp of first write.
- `updated_at` — ISO-8601 UTC timestamp of latest write.
- `confidence` — one of `verified` (direct from source system), `inferred` (derived), `uncertain` (flagged for review).
- `original_context` — short summary of the input that produced this entry, so future readers can judge currency.

Entries missing any of these five fields should be flagged and backfilled during the next curation sweep.

### Conflict Resolution

When two agents contribute conflicting information for the same vault entry:

1. **Do not auto-merge** — merging conflicting facts silently is worse than a clean conflict.
2. Store both claims in the entry under a `conflicts:` field, each with its `source_agent`, `timestamp`, and claim text.
3. Publish a `sentinel:alert` (via `event:publish`) with severity `MEDIUM` so a human can adjudicate.
4. Mark the entry `confidence: uncertain` until the conflict is resolved.

Exceptions: if one claim carries `confidence: verified` and the other `inferred`/`uncertain`, the verified claim wins automatically. Record the superseded claim under `history` with a `superseded_reason`.

### Deletion Policy

- **Soft-delete only.** Move entries to `vault/99-archive/` rather than calling destructive delete actions.
- Record `archived_at`, `archived_by`, `archive_reason` on the archived entry.
- Hard-delete requires an explicit human directive via Strategist and is logged to the audit trail.

### Schema Consistency

Every vault entry SHOULD have these fields. Missing fields block publication and trigger a re-normalization pass:

| Field | Type | Required |
|-------|------|----------|
| `title` | string | yes |
| `body` | markdown | yes |
| `tags` | array<string> | yes (controlled vocabulary) |
| `source_agent` | string | yes |
| `source_event` | string | yes |
| `created_at` | ISO-8601 | yes |
| `updated_at` | ISO-8601 | yes |
| `confidence` | enum | yes |
| `status` | enum (`draft`, `active`, `stale`, `archived`) | yes |
| `see_also` | array<path> | no |
| `history` | array<object> | no |
| `conflicts` | array<object> | no |

Entries that fail schema validation go to `vault/05-inbox/` with a `needs_review.md` sibling explaining what's missing.

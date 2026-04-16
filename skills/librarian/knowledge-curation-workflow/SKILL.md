# Librarian Skill: Knowledge Curation Workflow

> Master workflow for turning raw agent outputs into curated vault entries.
> Load this skill on every curation task (daily, weekly, directive, event-triggered).
>
> See also: `librarian-curation-workflow.md` (system prompt — has the per-task playbooks),
> `data-integrity.md` Vault Operations section (integrity rules this workflow assumes).

## Intake Sources

Librarian receives knowledge from five sources:

| Source | Trigger | Example |
|--------|---------|---------|
| Scheduled sweep | `daily_curation` / `weekly_curation` cron | Items in `vault/05-inbox/` |
| Agent standup reports | Observed via event bus (passive) | `standup:report` from any agent |
| Vault commits | `vault:entry_created` / `vault:entry_updated` | Another agent wrote directly to the vault |
| Incident post-mortems | `sentinel:incident_report` | Sentinel resolves an incident |
| Architecture decisions | `architect:spec_finalized` | Architect finalizes a spec |
| Directive outputs | `strategist:librarian_directive` | Strategist asks for specific curation work |

## Assessment Criteria

For each intake item, answer in order. First "no" short-circuits the pipeline.

1. **Is it actionable knowledge?** Something a future agent might need to answer a question or make a decision. Status pings and "deploy succeeded" messages are NOT actionable knowledge — drop them.
2. **Is it a decision (permanent) or a status (temporary)?** Decisions → persist. Status → reference in a standup summary and drop. Rule of thumb: if re-reading it in 6 months would still be useful, it's a decision.
3. **Is it already in the vault?** Run `vault:search` on the title keywords and the first paragraph content. If match >70% similarity → see `deduplication-and-merge/SKILL.md`.
4. **Does the source carry `confidence: verified`?** If not, flag for review via `confidence: uncertain` and still persist — but do NOT let it crowd out verified entries in default search results.

## Processing Pipeline

```
Receive → Deduplicate → Normalize → Apply taxonomy → Link → Write → Report
```

### Receive
Pull the raw input from its source (event payload, inbox file, directive). Do NOT alter the substance.

### Deduplicate
Apply the rules in `deduplication-and-merge/SKILL.md`. Output: either a "new entry" decision, an "update existing" decision, or a "drop as duplicate" decision.

### Normalize
- Standardize headers (H2 for sections, H3 for sub-sections).
- Resolve internal references to vault paths (`[[some-entry]]` → full path).
- Strip trailing whitespace, normalize line endings.
- Extract entities (service names, incident IDs, PR numbers) into the `entities` field.

### Apply Taxonomy
Apply controlled-vocabulary tags per `taxonomy-and-tagging/SKILL.md`. Reject free-form tags — only the vocabulary is allowed.

### Link
Per `graph-linking-rules/SKILL.md`: find related entries, add `see_also` links, create bidirectional edges.

### Write
Call `vault:write` with the full provenance block (see Quality Gates below). Mirror to the repo via `github:commit_file` if the vault entry has a tracked markdown file.

### Report
Publish `librarian:curation_complete` with counters (items triaged, published, dropped, conflicts raised).

## Quality Gates

Every entry written MUST have:

| Field | Required | Source |
|-------|----------|--------|
| `title` | yes | Derived from the content or passed in the payload |
| `body` | yes | Normalized markdown |
| `source_agent` | yes | From the event payload or inbox-file metadata |
| `source_event` | yes | Event type, or `manual` for directive-driven writes |
| `created_at` | yes | ISO-8601 UTC |
| `updated_at` | yes | ISO-8601 UTC (= `created_at` on first write) |
| `tags` | yes | Controlled vocabulary only |
| `confidence` | yes | `verified` / `inferred` / `uncertain` |
| `status` | yes | `draft` / `active` / `stale` / `archived` |

Missing any required field → entry goes to `vault/05-inbox/` with a sibling `needs_review.md` explaining what's missing. Do NOT publish incomplete entries into the canonical tree.

## Output

A curated vault entry with:
- Full provenance block.
- Controlled-vocabulary tags.
- Bidirectional `see_also` links to related entries.
- Mirrored GitHub commit (if applicable).
- A `librarian:curation_complete` event with run-level counters.

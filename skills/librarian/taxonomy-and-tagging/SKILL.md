# Librarian Skill: Taxonomy and Tagging

> Controlled vocabulary for vault tags and naming standards. Load before any
> `vault:write` call. Free-form tags are forbidden — only the vocabulary below
> is allowed. New tags must be added to this skill via directive before use.

## Top-Level Categories

Every entry lives under one of these seven categories, reflected both in the
vault path and the `category` tag:

| Category | Purpose | Path prefix |
|----------|---------|-------------|
| `architecture` | ADRs, system design, spec finalizations | `vault/20-architecture/` |
| `operations` | Runbooks, deploy procedures, ops SOPs | `vault/30-operations/` |
| `incidents` | Post-mortems, incident records | `vault/10-incidents/` |
| `decisions` | Non-architectural strategic decisions | `vault/40-decisions/` |
| `standards` | Style guides, review rubrics, policies | `vault/50-standards/` |
| `agents` | Per-agent capability/config documentation | `vault/60-agents/` |
| `deployments` | Deploy history, release notes, versions | `vault/70-deployments/` |

Plus the two utility directories: `vault/05-inbox/` (intake) and `vault/99-archive/` (soft-deleted).

## Tag Format

- **Lowercase, hyphenated.** `event-bus`, `deploy-pipeline`, `code-review`. Not `EventBus`, not `event_bus`, not `Event Bus`.
- **Max 30 characters.** Tags longer than that are a sign the concept should be split or given a shorter canonical form.
- **Singular over plural** where both exist. `incident`, not `incidents`. Exception: inherent plurals like `metrics`, `logs`.
- **No punctuation** except the hyphen. No `/`, `:`, `.`, `_`.

## Required Tag Namespaces

Every entry must include at least one tag from each of these namespaces:

### `category:*`
One of the seven top-level categories above. Always exactly one.

### `source:*`
The originating agent. Exactly one. Examples:
- `source:sentinel`, `source:architect`, `source:scout`, `source:ember`, `source:librarian`, `source:strategist`, `source:manual` (directive-driven, no single source agent).

### `status:*`
One of the temporal lifecycle states. Exactly one from the canonical five, unless the entry is actively in a conflict state (see exception below).

| Tag | Meaning |
|-----|---------|
| `status:draft` | Entry is incomplete or under review; do not surface in default searches |
| `status:current` | Active, canonical knowledge |
| `status:stale` | Flagged by hygiene audit as possibly outdated; may still be useful |
| `status:superseded` | Explicitly replaced by a newer entry (keep a `superseded_by` link) |
| `status:archived` | Soft-deleted; lives in `vault/99-archive/` |

**Exception: `status:conflict`.** Owned by `deduplication-and-merge/SKILL.md`. Applied transiently to entries where two agents contributed contradicting claims; pairs with the entry's `conflicts:` field. An entry carrying `status:conflict` retains one of the canonical five as its base status — the conflict tag is additive for this narrow case. When the conflict is resolved (human adjudication via Strategist), the `status:conflict` tag is removed and the base status may change (e.g., to `superseded` for the loser of the adjudication). Do NOT use `status:conflict` outside the dedup/merge flow.

## Optional Tag Namespaces

These are allowed but not required. Use where they add search value.

- `component:*` — service or module name (`component:event-bus`, `component:redis`, `component:mission-control`).
- `repo:*` — tracked repo name (`repo:yclaw`, `repo:yclaw-site`).
- `severity:*` — for incident records (`severity:critical`, `severity:high`, `severity:medium`, `severity:low`).
- `quarter:*` — temporal anchor for decisions (`quarter:2026-q2`).

## Naming Convention

Vault entry file names follow:

```
vault/{category-dir}/{YYYY-MM-DD}-{descriptive-slug}.md
```

Example: `vault/40-decisions/2026-04-15-ao-callback-url-fix.md`

- **Date is first-write date**, not subject date. Don't rename on update.
- **Slug is lowercase hyphenated**, max 60 characters.
- **No agent name in the slug.** Use the `source:*` tag instead.
- **No incident IDs in regular slugs.** Incidents use their own ID as the slug: `vault/10-incidents/inc-2026-04-15-aa12b.md`.

## Anti-Patterns

- **No `misc` or `other` tags.** If you can't categorize it, the entry probably isn't vault-worthy.
- **No untagged entries.** Missing tags is a schema violation — entry goes to `vault/05-inbox/needs_review.md`.
- **No tags longer than 30 characters.** Split or abbreviate.
- **No tags duplicating other metadata.** The `source_agent` provenance field and the `source:*` tag carry the same info — that's fine. But don't add a second `author:sentinel` tag.
- **Do not invent new top-level categories.** If one of the seven categories doesn't fit, flag via `sentinel:alert` MEDIUM and propose the new category via Strategist directive — do not silently create it.

## Vocabulary Evolution

New tags enter the controlled vocabulary only via:

1. Strategist directive with the new tag + justification, OR
2. A `librarian:curation_complete` run flagging a recurring pattern (same candidate tag appearing ≥5 times in 30 days with no home in the current vocabulary), reviewed manually.

Vocabulary changes are tracked in the Librarian agent's memory under key `taxonomy_version:` and versioned by date. Roll back by publishing a directive with the older version.

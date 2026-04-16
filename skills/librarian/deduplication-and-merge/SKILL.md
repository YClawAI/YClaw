# Librarian Skill: Deduplication and Merge

> Handling duplicate and overlapping vault entries. Load before any
> `vault:write` of a new entry. Duplicates are cheaper to prevent than to merge
> after the fact.
>
> See also: `data-integrity.md` Vault Operations (conflict resolution rules this
> skill must respect — never auto-merge conflicting claims).

## Detection

Before writing any new entry, run two searches:

1. **Title search.** `vault:search` on exact title match + fuzzy match on first three significant keywords.
2. **Body similarity.** `vault:search` on the first paragraph (or first 500 characters) of the new body.

Scoring:
- **Exact title match** → almost certainly duplicate. Proceed to canonical selection.
- **Fuzzy title match + body similarity >70%** → likely duplicate. Proceed.
- **Title mismatch but body similarity >85%** → probable duplicate with a renamed topic. Proceed with caution and include both titles in the merged entry's `aliases` field.
- **Everything else** → not a duplicate. Write as new entry.

Similarity estimation: use token-level Jaccard similarity when available, otherwise substring overlap as a fallback. Do NOT rely on a single word match.

## Canonical Selection

When duplicates are found, pick the canonical entry using this priority (first rule wins):

1. **Higher confidence source.** `verified` beats `inferred` beats `uncertain`.
2. **More recent `updated_at`.** More recent data wins over older data of equal confidence.
3. **More complete content.** The entry with a longer body that covers more of the topic wins.
4. **Existing inbound links.** If one entry has `see_also` back-links from multiple other entries, prefer keeping it (fewer link-rewrites downstream).

Record the selection reason in the merge's `history` entry so future auditors can understand why.

## Merge Rules

Once a canonical entry is chosen, and IF both entries contain unique non-contradicting information:

1. **Preserve the canonical entry's identity.** Its path, title, and ID do not change.
2. **Fold in unique content from the duplicate.** Append under a "## Merged from {duplicate title}" section, preserving attribution.
3. **Combine tags.** Take the union of both entries' tag sets. Deduplicate.
4. **Combine links.** Take the union of `see_also`. Deduplicate.
5. **Record both sources.** The `source_agent` and `source_event` fields on the canonical entry remain the canonical's. The duplicate's provenance goes into the `history` entry for this merge.
6. **Increment version.** Write with `updated_at` = now. Old content moves to `history[]`.

## Conflict Handling

If the two entries **contradict** each other on a factual claim:

1. **Do NOT auto-merge.** Silent merge of contradictions corrupts the knowledge base.
2. Add a `conflicts:` field on the canonical entry with both claims, each tagged with `source_agent` + `timestamp` + the specific conflicting text.
3. Apply `status:conflict` tag. (Note: this is a narrow exception to the taxonomy — `conflict` is one of two permitted non-controlled-vocabulary status values, alongside the core five. Document in `taxonomy-and-tagging/SKILL.md` if promoting to the main vocabulary.)
4. Publish `sentinel:alert` with severity MEDIUM and `alertType: vault_conflict`. Strategist adjudicates or delegates to a human.
5. Do NOT mark the duplicate as superseded until the conflict resolves — both live until a decision is made.

## Redirect / Tombstone

After a successful merge (not a conflict), the duplicate must not vanish silently:

1. Replace the duplicate's body with a redirect stub:

   ```markdown
   > **Redirect:** This entry was merged into [{canonical title}]({canonical path}).
   > Merge date: {iso date}
   > Merged by: librarian ({run id})
   ```

2. Set `status: superseded` and `superseded_by: {canonical path}`.
3. Move the duplicate file to `vault/99-archive/` with the archive metadata (`archived_at`, `archived_by: librarian`, `archive_reason: merged_duplicate`).
4. Update every entry that had a `see_also` pointing to the duplicate so it now points to the canonical. Record each rewrite in the rewritten entry's `history`.

## Redirect Validation

After a redirect is in place, the next weekly hygiene audit (see `vault-hygiene-audit/SKILL.md`) must:

- Verify the redirect target still exists.
- Verify no lingering entries still link to the old location (inbound link count should be zero — all rewritten in step 4 above).

If either check fails, log as a hygiene violation and flag for Strategist review.

## When NOT to Merge

Situations where duplicates should STAY separate:

- **Different temporal scope.** A 2024 runbook and a 2026 runbook on the same topic are both valid — the older one is `status:superseded`, not merged.
- **Different audiences.** An `agents/*` entry written for an agent to load, vs. a `standards/*` entry written for a human reader. The substance may be similar but the consumer is different.
- **Different confidence levels.** A `verified` entry should not be merged with an `uncertain` entry. The merge would downgrade the verified one.

In all these cases, link them via `see_also` with an explanatory note, but keep both.

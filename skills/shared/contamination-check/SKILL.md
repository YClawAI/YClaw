---
name: contamination-check
description: "Detect and prevent product-specific terminology contamination across skills/ and prompts/. Run after any bulk content update, skill import from another project, or agent config change. Applied as a shared skill across all agents."
metadata:
  version: 1.0.0
  type: on-demand
---

# Contamination Check

This skill defines the operational procedure for preventing and detecting prompt /
skill contamination — the situation where files describe a *different* product than
the one the agent org is actually running.

### The incident that required this skill

YClaw's `skills/shared/` was formerly populated with ~1,200 lines of Solana DeFi
protocol documentation (watchers, creator rewards program, bonding curves, staking,
the Chrome extension). Every agent loading shared skills believed it was operating
an attention-rewards protocol instead of an AI agent orchestration framework. This
was fixed in the P0 cleanup (commit `1e63cb6` on `fix/exec-p0-shared-skills`). The
procedure below exists so we catch the next one before it causes similar drift.

---

## Detection

### Grep patterns — run on every bulk change

Run these patterns after any of:
- `skills/` or `prompts/` gets a bulk content update (>5 files changed)
- A skill was imported from an external source (copy-pasted from another repo)
- An agent config has its `system_prompts`, `triggers`, or `actions` restructured
- A department YAML / event policy is migrated

```bash
# Solana / DeFi contamination (from the original incident)
grep -rn -iE "bonding curve|\bTVL\b|staking|chrome extension|watch-to-earn|attention rewards|solana protocol|options minting|mayflower|xeenon|\$YCLAW token" skills/ prompts/ \
  --include="*.md" --include="*.yaml" --include="*.yml" 2>/dev/null \
  | grep -ivE "(not |never |no |don.t |replaced|instead of|^.+/brand.voice|^.+/review.rules|^.+/faq.bank)"

# Generic contamination — copy-paste from another project
grep -rn -iE "gaze protocol|gaze-agents|gazeprotocol|crediez|\bGZC\b" skills/ prompts/ 2>/dev/null

# Placeholder / template markers left unresolved
grep -rn -E "<!-- CUSTOMIZE|<!-- TODO|XXX:|FIXME:" skills/ prompts/ 2>/dev/null
```

### Layered exclusion (the meta-problem)

A naive grep hits false positives in rule-documentation files (brand-voice,
review-rules, claims-risk, faq-bank) — these files LIST banned terms as examples of
what NOT to use.

Three exclusion layers (apply in order):

1. **Content-based exclusion** — lines that contain negation keywords:
   `(not |never |no |don.t |replaced|instead of)`

2. **Filename-based exclusion** — files whose purpose is to document the banned terms:
   `(brand.voice|review.rules|moderation.rules|claims.risk|faq.bank)`

   Use dots (`.`) not specific separators to match both `brand-voice.md` and
   `BRAND_VOICE.md`.

3. **Context-based exclusion** — specific meta-phrases (YClaw-specific):
   `(Don.t Use|Banned|Never use|❌|historical|outdated|hashtag)`

Full pattern (after layered exclusion):
```bash
grep -rn -iE "<PATTERNS>" skills/ prompts/ --include="*.md" 2>/dev/null \
  | grep -ivE "(not |never |no |don.t |replaced|instead of)" \
  | grep -vE "(brand.voice|review.rules|faq.bank|claims.risk|contamination.check)"
```

Expected: zero hits after layered exclusion on a clean repo.

### When to run

| Trigger | Scope | Who runs it |
|---|---|---|
| After a bulk skill import | `skills/` only | Reviewer during the review_content task |
| After a prompt template expansion | `prompts/` only | Reviewer |
| Before any external publish referencing the product | `skills/shared/`, `prompts/` | Reviewer (blocks publish on hit) |
| Per CI run | `skills/`, `prompts/` | CI workflow (recommended: `.github/workflows/contamination-check.yml`) |
| Every weekly_directive | Full scan | Strategist (review before dispatching ambitious directives) |

---

## Prevention

### Rules for new shared skills (`skills/shared/`)

1. **Mandatory frontmatter** — every SKILL.md must have `name`, `description`, `type`,
   and `version` in YAML frontmatter.
2. **No imports without review** — a skill pulled from another project is reviewed
   BEFORE merge for product-specific terminology. Grep it with the patterns above
   during review.
3. **Template markers resolved** — no `<!-- CUSTOMIZE -->` or `[your-*-channel]`
   placeholders allowed in merged shared skills. CI should fail on any hit.

### Rules for new agent prompts (`prompts/`)

1. **Placeholder audit on merge** — any prompt with `<!-- CUSTOMIZE -->` blocks merge
   until the placeholder is resolved OR the markers are explicitly converted to
   forked-project scaffolding markers (different token).
2. **Canonical product reference** — if a prompt references "the product", it must
   reference YClaw specifically, not a generic / inherited description.
3. **Cross-file consistency** — if prompt A references a skill or file path, the
   referenced artifact must exist (see `agent-prompt-action-allowlist-audit` for
   the action-allowlist version of this check).

### Import workflow

When importing a skill from another repo:

1. Copy the skill into a feature branch (not directly to `main`)
2. Run detection greps on the imported file
3. Rewrite any product-specific references to YClaw equivalents
4. Add frontmatter if missing
5. Cross-reference any cited file paths — must resolve in THIS repo
6. Open a PR; Reviewer runs the grep again as part of review

---

## Response

If contamination is found:

### Single-file contamination (small, recent)

1. Open an issue: `Contamination: <file> — <pattern>`
2. Revert the contaminated content OR rewrite in a fix PR
3. Tag the PR with `contamination-fix` label
4. Update this skill's detection pattern list if a new class of contamination
   was identified

### Widespread contamination (the P0 scenario)

1. **Halt external publishing.** Reviewer blocks all `review_content` tasks until
   cleanup is verified.
2. **Post to #yclaw-alerts** with a 🚨 severity — contamination affects every agent
   loading shared content.
3. **Quarantine** — move contaminated files to `.quarantine/<timestamp>/` (still in
   repo, but not loaded by any agent). This preserves git history while stopping
   runtime effect.
4. **Open an issue per file** for the rewrite effort; dispatch `strategist:architect_directive`
   if coordination is needed.
5. **After cleanup:** run all detection greps with zero-hit acceptance criteria
   before re-enabling external publishing.

### If contamination is in an external-facing post

1. Reviewer BLOCKS the post (`reviewer:flagged` severity: high)
2. Post a corrective message to the originating channel ONLY if the post already
   went out (extremely rare — contamination usually caught at review, not post-publish)
3. Escalate to Elon via `discord:alert` — public-facing contamination is a brand /
   legal concern

---

## Example — the P0 incident in detail

**Discovery:** During the Executive department audit (PR #115), a reviewer noticed
that `skills/shared/protocol-overview/SKILL.md` described YClaw as "an attention
rewards protocol on Solana" — contradicting `mission_statement.md` and CLAUDE.md.

**Detection grep:**
```
grep -rn -iE "bonding curve|TVL|attention rewards|solana protocol|chrome extension" skills/shared/
```
Returned ~120 hits across 4 files: `protocol-overview/SKILL.md`, `copy-bank.md`,
`faq-bank.md`, `creator-rewards-program.md` (the last one was unique to the old
product and had no analog).

**Response:**
1. Deleted `creator-rewards-program.md` (no YClaw equivalent)
2. Rewrote `protocol-overview/SKILL.md`, `copy-bank.md`, `faq-bank.md` from scratch
   describing YClaw as an AI agent orchestration framework
3. Ran detection grep with layered exclusion — zero hits on P0 scope
4. Flagged further contamination in per-agent skills (`skills/guide/`, `skills/scout/`,
   `skills/ember/`, `skills/keeper/`) as P1 follow-up — these still need cleanup as
   of this skill's authoring date

Lesson: the shared skill directory was patient-zero because every agent loads it.
Per-agent skill contamination has narrower blast radius but is still real.

---

## Related skills

- `agent-prompt-action-allowlist-audit` — catches unexecutable instructions in
  prompts that reference tools an agent doesn't have (similar class of cross-file
  consistency bug).
- `terminology-regression-lint` (user-level skill) — CI automation for preventing
  re-contamination after a cleanup.
- `source-audit` (user-level skill) — audit external docs/configs before ingesting
  them into the project.

---

## Out of scope

- Writing new content → origin agent's job.
- Brand voice compliance → see `reviewer/brand-enforcement` skill.
- License / legal claims → see `reviewer/oss-legal-guardrails` skill.

# Sentinel Skill: Repo Hygiene Audit

> Repository health beyond code quality. Load this skill during
> `weekly_repo_digest` (Friday 17:00 UTC). Covers branch hygiene, dependency
> health, CI health, documentation drift, config drift, and orphaned files.
>
> See also: `code-audit-standards.md` for code-level audit rubric,
> `deploy-health-checklist.md` for deployment-side checks.

## Scope

For each repo returned by `repo:list`, run the six checks below. Report findings
as a `sentinel:quality_report` payload at the end.

## 1. Stale Branches

**Check:** Branches with no commit activity >14 days AND no open PR.

How:
- `github:get_contents` on the repo's branch list.
- Cross-reference with open PRs (ignore branches backing active PRs).
- For each orphan branch: note last commit date and last author.

Report threshold: 5+ stale branches = MEDIUM finding, 15+ = HIGH finding.
Recommendation: flag; do NOT auto-delete. Branch deletion requires human sign-off.

## 2. Dependency Health

**Check:** Known vulnerabilities (CVE), outdated major versions.

How:
- `github:get_contents` on `package.json` / `Cargo.toml` / requirements.
- Compare against a recent snapshot in agent memory (`dep_snapshot:{repo}`).
- For Node repos, surface any dependency with a major-version lag ≥2 (e.g., v4.x when v6.x is latest stable).

Sentinel does NOT run `npm audit` directly (no codegen execution). Instead:
- Check `github:get_contents` for `.github/workflows/` — if an audit workflow exists, query its latest run via the GitHub Actions API.
- If no audit workflow exists, flag that as a finding (HIGH): the repo has no automated vulnerability scanning.

## 3. CI Health

**Check:** Flaky tests, slow test suites, disabled tests.

How:
- `github:get_contents` on recent workflow runs (last 30 days).
- Flaky signal: same test file appears in both `success` and `failure` runs within 7 days for the same commit SHA range. Report as MEDIUM.
- Slow signal: workflow run duration >5 minutes. Report as LOW unless >15 minutes (MEDIUM).
- Disabled tests: grep for `.skip(` / `it.skip(` / `describe.skip(` / `@Disabled` in test files. Count and report MEDIUM if >5.

## 4. Documentation Drift

**Check:** README/CLAUDE.md last-modified vs code last-modified. If code changed significantly but docs didn't, flag.

How:
- Use `github:get_contents` with metadata to get `last_modified` for `README.md` and `CLAUDE.md`.
- Compare against the repo's most recent merged PR date.
- Drift signal: docs not touched in the last 90 days AND there have been ≥5 feature-labeled PRs merged in that window. Report MEDIUM.

Do NOT auto-flag projects with zero docs. That's a different finding (absence vs drift).

## 5. Config Drift

**Check:** YAML configs vs actual runtime behavior.

This is the finding class that originated this audit cycle. Examples:
- YAML declares an action as allowed but runtime never uses it.
- Prompt references an event type that no subscriber listens for.
- Task referenced in a cron schedule but the task prompt is missing.

How:
- For YCLAW-style repos: cross-reference `departments/**/*.yaml` `actions:` lists against prompt references with `grep -rn`.
- Missing task prompts: cron `task: foo` where no section `## Task: foo` exists in any loaded prompt.

Report HIGH for dead events (no subscriber) or hallucinated tools (referenced but not allow-listed). MEDIUM for the reverse (allow-listed but never used — dead config is cheap bloat).

## 6. Orphaned Files

**Check:** Files not imported or referenced anywhere in the repo.

How:
- `github:get_contents` on the tree listing.
- For each source file, grep the rest of the tree for a reference (import, require, link, mention).
- Files with zero inbound references AND not a top-level entry point (index.*, main.*, README.md, etc.) are orphans.

Report LOW individually, MEDIUM if >20 orphans in one repo.

## Reporting

After all six checks, publish a single `sentinel:quality_report` event with the aggregated findings. Do NOT fire a separate alert per check — one report per audit cycle. Per-finding alerts go out only if any single finding is classified HIGH.

Post a brief Discord summary to the operations channel with the counts per severity. Full details live in the event payload for Librarian to curate into the vault.

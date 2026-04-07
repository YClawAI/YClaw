# Engineering Standards

> Development department standards for code quality, review, testing, and deployment.
> Loaded by Architect and Deployer on every execution. When reviewing PRs, assessing
> deployments, or proposing changes, apply these standards consistently.
>
> Adapted from [Trail of Bits engineering standards](https://github.com/trailofbits/claude-code-config).

---

## Philosophy

- **No speculative features.** Don't add features, flags, or configuration unless actively needed. Don't build for hypothetical future requirements.
- **No premature abstraction.** Don't create utilities until the same code appears three times. Three similar lines are better than a premature helper.
- **Clarity over cleverness.** Prefer explicit, readable code over dense one-liners or clever patterns.
- **Justify new dependencies.** Each dependency is attack surface and maintenance burden. Question every `npm install`.
- **No phantom features.** Don't document or validate features that aren't implemented.
- **Replace, don't deprecate.** When a new implementation replaces an old one, remove the old one entirely. No backward-compatible shims, dual config formats, or migration paths. Proactively flag dead code.
- **Verify at every level.** Automated guardrails (linters, type checkers, tests) are the first step, not an afterthought. Structure-aware tools over text pattern matching.
- **Finish the job.** Handle the edge cases you can see. Clean up what you touched. If something is broken adjacent to your change, flag it. But don't invent new scope — thoroughness is not gold-plating.

---

## Code Quality

### Hard Limits

1. **100 lines per function maximum.** If a function exceeds this, it needs decomposition.
2. **Cyclomatic complexity 8 or less.** Deeply nested conditionals are a review flag.
3. **5 positional parameters maximum.** Use an options object beyond that.
4. **100-character line length.** No exceptions for string literals — break them.

### Zero Warnings Policy

Fix every warning from every tool — linters, type checker, compiler, tests. If a warning truly can't be fixed, add an inline ignore with a justification comment. A clean output is the baseline, not the goal.

### Comments

Code should be self-documenting. No commented-out code — delete it. If you need a comment to explain WHAT the code does, refactor the code instead. Comments explain WHY, not what.

### Error Handling

- Fail fast with clear, actionable messages.
- Never swallow exceptions silently.
- Include context: what operation, what input, what failed.
- `JSON.stringify(error)` produces `{}` — always extract `.message` and `.stack` before logging.

---

## TypeScript / Node Standards

**Runtime:** Node 20 LTS, ESM only (`"type": "module"`).

| Purpose | Tool |
|---------|------|
| Type check | `tsc --noEmit` |
| Test | `vitest` |
| Build | `turborepo` |

### Strict TypeScript

All of these must be enabled in `tsconfig.json`:

```jsonc
"strict": true,
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true,
"noImplicitOverride": true,
"verbatimModuleSyntax": true,
"isolatedModules": true
```

### Import Conventions

- ESM imports with `.js` extensions (TypeScript resolves `.ts` → `.js` at compile time).
- Absolute imports from package root — no relative `../../../` chains.
- `import type` for type-only imports (enforced by `verbatimModuleSyntax`).

---

## Testing

### Principles

**Test behavior, not implementation.** Tests verify what code does, not how it does it. If a refactor breaks tests but not functionality, the tests were wrong.

**Test edges and errors, not just the happy path.** Empty inputs, boundaries, malformed data, missing services, null responses. Bugs live in edges.

**Mock boundaries, not logic.** Only mock things that are slow (network, filesystem), non-deterministic (time, randomness), or external services you don't control. Never mock the code under test.

### Vitest Conventions

- Colocated test files: `*.test.ts` next to source files, or in `tests/` directory.
- Use `vi.mock()` with class factories for constructable dependencies (see `vitest-mock-constructor` pattern).
- Per-package `vitest.config.ts` in turborepo monorepo — root config paths don't resolve correctly from package CWD.
- `vi.resetModules()` + dynamic `import()` for code that reads `process.env` at module load time.

---

## Code Review

### Review Order

Evaluate changes in this order — don't jump to style nits before understanding the architecture:

1. **Architecture** — Does the design make sense? Is it the right abstraction level?
2. **Correctness** — Does it actually work? Are there logic errors?
3. **Security** — Does it introduce vulnerabilities? Check OWASP top 10, injection, escalation.
4. **Tests** — Are edge cases covered? Do tests verify behavior, not implementation?
5. **Performance** — Only after the above. Premature optimization is still the root of evil.

### Review Communication

For each issue found:
- Describe concretely with `file:line` references.
- Present options with tradeoffs when the fix isn't obvious.
- Recommend one approach.
- Classify severity: P1 (blocks merge), P2 (should fix), P3 (nice to have), P4 (nit).

---

## Workflow

### Commits

- Imperative mood, 72-character subject line maximum, one logical change per commit.
- Never amend or rebase commits already pushed to shared branches.
- Never push directly to `master` — use feature branches and PRs.
- Never commit secrets, API keys, or credentials.

### Pull Requests

Describe what the code does now — not discarded approaches, prior iterations, or alternatives. Only describe what's in the diff.

Use plain, factual language. A bug fix is a bug fix, not a "critical stability improvement." Avoid: critical, crucial, essential, significant, comprehensive, robust, elegant.

### Deployment Assessment

Before approving a deployment:
1. All CI checks passing (type check, tests, lint).
2. No new warnings introduced.
3. Secrets Manager keys match task definition expectations.
4. Docker image builds on `linux/amd64` without cache.
5. ECS task definition revision matches what the service will deploy.
6. Health check endpoint (`/health`) responds correctly.

### Rollback Criteria

Flag for immediate rollback if:
- Health check fails within 2 minutes of deployment.
- Error rate exceeds baseline by 3x in first 10 minutes.
- Core functionality is degraded or unresponsive.

---

*Based on [Trail of Bits Claude Code Config](https://github.com/trailofbits/claude-code-config) — adapted for YClaw development department.*

# Contributing to YCLAW

Thanks for your interest in contributing. This guide covers setup, conventions, and how to submit changes.

---

## Prerequisites

- Node.js 20+
- npm 10+
- Docker with Compose v2 (for integration testing)
- Git

---

## Setup

```bash
git clone https://github.com/YClawAI/yclaw.git
cd yclaw
npm install
```

### Build

```bash
npm run build                # Build all packages
npx turbo build              # Same, via Turborepo
```

### Run Tests

```bash
# All tests
npm test

# Per-package
npm run test --workspace=packages/core
npm run test --workspace=packages/cli
npm run test --workspace=packages/memory

# Type check
npx tsc -p packages/core/tsconfig.json --noEmit
npx tsc -p packages/cli/tsconfig.json --noEmit
```

### Run Locally

```bash
# Generate config
npx yclaw init --preset local-demo

# Deploy with Docker Compose
npx yclaw deploy --dev --detach

# Open Mission Control
open http://localhost:3001

# Tear down
npx yclaw destroy
```

---

## Monorepo Structure

| Package | What It Is | Key Commands |
|---------|-----------|-------------|
| `packages/core` | Runtime engine — agents, operators, events, safety | `npm run test --workspace=packages/core` |
| `packages/cli` | `yclaw` CLI — init, doctor, deploy, status | `npm run test --workspace=packages/cli` |
| `packages/memory` | PostgreSQL-backed agent memory | `npm run test --workspace=packages/memory` |
| `packages/mission-control` | Next.js 14 dashboard | `npm run dev --workspace=packages/mission-control` |

---

## Conventions

### TypeScript

- Strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- ESM only — use `.js` extensions in imports
- `import type` for type-only imports
- Zod for schema validation

### Testing

- Framework: Vitest
- Test location: `packages/<pkg>/tests/*.test.ts` (NOT colocated with source)
- Pattern: test behavior, not implementation. Mock boundaries, not logic.
- Naming: `{module-name}.test.ts` matching the source file basename

### Code Style

- 100-character line length
- 100 lines per function maximum
- No commented-out code — delete it
- Comments explain WHY, not WHAT
- Fail fast with clear, actionable error messages

### Commits

- Imperative mood, 72-character subject line
- One logical change per commit
- Never push directly to `main`

---

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Run tests: `npm test && npx tsc -p packages/core/tsconfig.json --noEmit`
4. Push and open a PR against `main`

### PR Checklist

- [ ] Tests pass (`npm test`)
- [ ] Type check passes (`npx tsc --noEmit`)
- [ ] No new dependencies without justification
- [ ] Documentation updated if behavior changed
- [ ] No secrets or credentials committed

---

## Building Custom Adapters

YCLAW uses pluggable adapter interfaces. To add support for a new database, message broker, or channel:

1. Implement the relevant interface (`IStateStore`, `IEventBus`, `IChannel`, `ISecretProvider`, `IObjectStore`)
2. Add your adapter to `packages/core/src/adapters/<category>/`
3. Wire it into `InfrastructureFactory` with a new config `type`
4. Add tests
5. Update `docs/configuration.md`

See [docs/adapters.md](docs/adapters.md) for the full guide.

---

## Protected Paths

These paths have extra governance and require careful review:

| Path | Protection Level |
|------|-----------------|
| `.github/workflows/**` | CI-enforced — requires `human-approved` label |
| `packages/core/src/security/**` | CI-enforced — requires `human-approved` label |
| `packages/core/src/review/**` | CI-enforced — requires `human-approved` label |
| `departments/**` | Convention — Architect review |
| `prompts/*.md` | Convention — Architect review |
| `CLAUDE.md` | Convention — Architect review |

---

## Reporting Security Issues

Do **not** open public GitHub issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

---

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

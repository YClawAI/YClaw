# YClaw Repository Conventions

## Monorepo Structure
- TypeScript monorepo (turborepo + npm), Node 20 LTS, ESM only
- Agent configs: `departments/<dept>/<agent>.yaml`
- System prompts: `prompts/*.md`

## TypeScript Rules
- Strict mode mandatory: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- ESM imports with `.js` extensions
- `import type` for type-only imports
- `verbatimModuleSyntax` and `isolatedModules` enabled

## Naming Conventions
- Files: kebab-case (`cost-tracker.ts`, `hard-gate-runner.ts`)
- Classes: PascalCase (`CostTracker`, `HardGateRunner`)
- Functions/variables: camelCase
- Constants: UPPER_SNAKE_CASE for env vars and config keys
- Test files: `packages/core/tests/{module-name}.test.ts` (NOT colocated with source)

## Code Style
- 100 lines per function maximum
- 100-character line length
- No commented-out code
- Comments explain WHY, not WHAT
- Prefer standard library over third-party

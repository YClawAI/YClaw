# YClaw Testing Standards

## Framework
- vitest for all tests
- Config: `packages/core/vitest.config.ts`
- Test location: `packages/core/tests/*.test.ts` (NOT colocated with source)

## Quality Bar
- `npm run build` must pass (turborepo build)
- `npx tsc --noEmit` must pass (zero type errors)
- `npm test` must pass (all vitest suites)
- `npm run lint` must pass

## Test Conventions
- Test behavior, not implementation
- Mock boundaries, not logic
- Naming: `{module-name}.test.ts` matching source file basename
- Each test should be independent (no shared mutable state between tests)

## Before Submitting
Run the full check sequence:
```bash
npx tsc -p packages/core/tsconfig.json --noEmit
npx vitest run
```
Both must pass with zero failures.

# Architect Skill: Review Checklist

> Standard review criteria for PR reviews. Load this skill when reviewing PRs.

## Fast-Pass Review (< 5 minutes)

Quick checks before deep review. If any fail, REQUEST_CHANGES immediately:

- [ ] PR has a description (not empty body)
- [ ] Branch name follows convention (`agent/`, `fix/`, `feature/`, `config/`)
- [ ] No changes to protected files (outbound safety, CI workflows) without justification
- [ ] No hardcoded secrets, API keys, or credentials
- [ ] No `console.log` or debug statements left in production code

## Deep Review Checklist

### Code Quality
- [ ] Changes are scoped to what the issue/directive asked for (no scope creep)
- [ ] New functions/classes have JSDoc or inline documentation
- [ ] Error handling: try/catch where appropriate, errors logged with context
- [ ] No TODO comments without linked issues

### Architecture
- [ ] Follows existing patterns in the codebase (don't invent new patterns for one-off use)
- [ ] No circular dependencies introduced
- [ ] Imports use project conventions (`.js` extension for ESM)
- [ ] No premature abstraction (single-use abstractions are worse than duplication)

### Types & Safety
- [ ] TypeScript strict mode satisfied (no `any` without justification)
- [ ] New interfaces/types are well-named and documented
- [ ] Nullable fields handled (no unchecked `!` assertions)

### Testing
- [ ] Existing tests still pass
- [ ] New functionality has corresponding tests (or justification for skipping)
- [ ] Test assertions are meaningful (not just "it doesn't throw")

### Security (P0 — always check)
- [ ] No secrets in code
- [ ] No SQL injection vectors (parameterized queries)
- [ ] No unsafe `eval()` or dynamic code execution
- [ ] Rate limits on new endpoints
- [ ] Auth checks on protected routes

## Common Finding Categories

| Category | Severity | Example |
|----------|----------|---------|
| Security | P0 | Hardcoded API key, missing auth check |
| Correctness | P1 | Logic error, wrong return type, race condition |
| Architecture | P2 | Wrong pattern, coupling, circular dependency |
| Maintainability | P3 | Missing docs, unclear naming, no tests |
| Style | P4 | Formatting, import order (nit) |

## Cross-Backend QA

When reviewing Builder's code:
- If Builder used Claude Code → review with Codex perspective
- If Builder used Codex → review with Claude Code perspective
- Focus on: patterns the other model would catch (e.g., Codex catches Node.js idioms Claude misses)

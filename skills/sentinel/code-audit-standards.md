# Code Audit Standards

> Load this skill during `code_quality_audit` tasks (Mon/Thu).

## Audit Scope

Use `codegen:execute` to scan repos for machine-verifiable issues ONLY.
Never flag style opinions (naming, formatting, whitespace).

## Severity Levels

### 🔴 High — Alert immediately
- **Hardcoded secrets**: API keys, tokens, passwords in source code
- **SQL injection vectors**: Unsanitized user input in queries
- **Broken imports**: Import paths pointing to modules that don't exist
- **Security vulnerabilities**: Known CVEs in direct dependencies
- **Exposed endpoints**: Routes without authentication that should have it

### 🟡 Medium — Include in weekly summary
- **Dead exports**: Functions/types exported but never imported anywhere
- **Missing error handling**: Async operations without try/catch or .catch()
- **Deprecated API usage**: Using APIs marked for removal
- **Test coverage gaps**: New source files with zero corresponding test files
- **Type safety holes**: Explicit `any` types that could be narrowed

### 🟢 Low — Log only
- **TODO/FIXME comments** older than 30 days
- **Unused dependencies** in package.json
- **Console.log statements** left in production code
- **Missing JSDoc** on public API functions

## codegen:execute Template

```json
{
  "repo": "<repo name>",
  "task": "Code quality audit. Check ONLY machine-verifiable issues:\n1. Hardcoded secrets (API keys, tokens, passwords)\n2. Broken imports (missing modules)\n3. Dead exports (zero consumers)\n4. Test coverage gaps (new files without tests)\n5. Security: SQL injection, exposed endpoints\n\nOutput as JSON: { repo, issues: [{ severity: 'high'|'medium'|'low', file, line, description }] }",
  "run_tests": false,
  "backend": "claude",
  "agent_name": "sentinel"
}
```

## Rules

- **NEVER open PRs or commit fixes.** Report findings only.
- **ALWAYS include file paths and line numbers.**
- **Compare to previous scan** — flag repos where quality is degrading.
- **High severity → `sentinel:alert` event + alert to operations channel.**
- **Medium severity → aggregate into `sentinel:quality_report` event.**

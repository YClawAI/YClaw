# Code Audit Standards

> Load this skill during `code_quality_audit` tasks (Mon/Thu).

## Audit Scope

Use `github:get_contents` and `github:get_diff` to scan repos for machine-verifiable issues ONLY.
**Do NOT use `codegen:execute` or `codegen:status`.** Sentinel is a read-only auditor.
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

## Read-Only Scan Approach

Use `github:get_contents` to fetch source files and `github:get_diff` to inspect recent changes.
Sentinel **never executes code** — all analysis is performed by reading file contents directly.

Example: fetch a file for inspection
```json
{
  "repo": "<org>/<repo-name>",
  "path": "<file-path>"
}
```

Example: inspect recent changes for a targeted diff review
```json
{
  "repo": "<org>/<repo-name>",
  "base": "<base-sha-or-branch>",
  "head": "HEAD"
}
```

For each file retrieved, inspect the raw content for the severity-level issues listed above.
Aggregate findings and report as: `{ repo, issues: [{ severity, file, line, description }] }`

## Rules

- **NEVER open PRs or commit fixes.** Report findings only.
- **ALWAYS include file paths and line numbers.**
- **Compare to previous scan** — flag repos where quality is degrading.
- **High severity → `sentinel:alert` event + alert to operations channel.**
- **Medium severity → aggregate into `sentinel:quality_report` event.**

# Development Escalation Policy

> Development-specific supplement to the org-wide `escalation-policy.md`. Load alongside,
> not instead of, the general escalation policy.

## When to Escalate to Strategist

- Architecture decisions affecting multiple repos or departments
- Unresolvable merge conflicts between agent directives
- Security incidents (credential exposure, vulnerability discovery)
- CI/CD pipeline failures lasting > 2 hours
- Any request to modify governance policies or agent permissions

## When to Notify Humans

- Failed deploys to production
- PRs touching protected files (CI workflows, outbound safety, secrets)
- Cost anomalies (unusual API usage spikes)
- Any action that could affect external users

## When to Halt Execution

- Contradictory directives from different sources
- Missing required context (can't load skills or design refs)
- Safety gate failures

## Delegation: Mechanic vs AO

| Task Type | Route To | Reason |
|-----------|----------|--------|
| Lockfile sync, formatting, linting | Mechanic | Shell-required, low risk |
| Branch rebasing | Mechanic | Mechanical, no judgment |
| Feature implementation | AO | Requires code generation |
| Bug fixes | AO | Requires understanding + code |
| Infra provisioning | AO (with Architect review) | Complex, needs oversight |

## Incident Severity

| Severity | Description | Response Time | Escalate To |
|----------|-------------|---------------|-------------|
| P0 | Production down, security breach | Immediate | Strategist + Human |
| P1 | CI broken, deploys blocked | < 1 hour | Strategist |
| P2 | Non-blocking bugs, tech debt | Next standup | Log in issue |
| P3 | Polish, optimization | When convenient | Backlog |

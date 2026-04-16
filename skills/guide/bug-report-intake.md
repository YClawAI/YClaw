# Bug Report Intake

> Use when a user reports a potential bug that may need escalation to Architect.

## Information to Collect

Before escalating, gather as much of this as possible:

### Required
1. **Description:** What happened? What did they expect?
2. **Steps to reproduce:** Exact sequence of actions
3. **Error messages:** Exact text, screenshots, or log snippets
4. **YCLAW version:** Commit hash or release version

### Helpful
5. **Environment:** OS, Node.js version, Docker version (if applicable)
6. **Configuration:** Relevant YAML snippets (remind user to redact API keys)
7. **Logs:** Relevant log output from YCLAW startup or runtime
8. **Frequency:** Does it happen every time, intermittently, or once?
9. **Workaround:** Have they found any way around it?

## Intake Template

When collecting from the user, use this as a guide:

```
Can you help me with a few details so we can investigate?

- What were you trying to do?
- What happened instead?
- Can you share the exact error message?
- What version of YCLAW are you running?
- What OS and Node.js version?
- Can you share the relevant part of your YAML config? (Please remove any API keys first)
```

## Escalation Format

When escalating to Architect via `guide:case_escalated`:

```
🐛 Bug Report — [Brief Title]

Reporter: [anonymized identifier]
Priority: [P0/P1/P2]
Frequency: [always / intermittent / once]

Description:
[What happened vs expected behavior]

Steps to Reproduce:
1. [step]
2. [step]
3. [step]

Error:
[exact error message or log]

Environment:
- YCLAW: [version/commit]
- OS: [os]
- Node: [version]

Config (redacted):
[relevant yaml]

Workaround: [if any]
```

## Rules
- Never ask for API keys, credentials, or .env files
- Always anonymize user identity in escalation posts
- If the bug involves a security vulnerability, escalate to Sentinel + team lead privately — do NOT post details publicly
- If multiple users report the same issue, note the count in escalation

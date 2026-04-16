# Data Verification Rules (All Agents)

> These rules apply to ALL agents when reporting status, blockers, or completions.

## Mandatory Verification

1. **Verify via tool calls, not memory.** Before reporting any status, make the actual
   API call to check current state.

2. **Include evidence.** PR numbers, issue numbers, deploy IDs, timestamps.
   Not vague claims like "processed N tasks."

3. **Verify blockers are still blocked.** Before reporting ANY blocker:
   - Action failures → call the action now. If it works, DROP the blocker.
   - Missing config/access → check current state. If resolved, DROP it.
   - Stale issues → check if still open. If closed, DROP it.

4. **Verify completions are actually complete.** Before reporting "Done":
   - PRs → verify actually merged
   - Issues → verify actually closed
   - Deploys → verify actually completed

5. **Prefix unverified claims.** If you cannot verify something, prefix with
   "UNVERIFIED:" so downstream consumers know.

## Anti-Patterns (Never Do These)

- "Maintained quality standards" — meaningless. What specifically?
- "Processed N tasks" — which tasks? With what outcomes?
- "Working on X" from memory — is X actually in progress right now?
- Reporting old failures as current — check if they've been fixed

This file should be referenced from department-specific standup prompts.

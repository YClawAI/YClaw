# Review Rules

## Reviewer Agent Configuration

The Reviewer agent is the quality gate for all external-facing content and code changes. These rules define what gets reviewed, how, and what action to take.

## Content Review Rules

### Auto-Approve (No Review Needed)
- Internal status updates to Discord channels
- Agent standup reports
- Memory writes
- Event publications between agents
- Discord reactions and thread replies to existing conversations

### Review Required
| Trigger | Check | Pass Criteria | Fail Action |
|---------|-------|---------------|-------------|
| `review:pending` from any agent | Securities language scan | Zero matches against blocklist | Reject with specific violations |
| `review:pending` with `target_platform: x` | Brand voice compliance | Matches tone in brand-voice.md | Flag with suggestions |
| `review:pending` with `urgency: high` | Fast-track review | Basic safety check only | Approve or reject within 1 execution |
| External-facing content mentioning people | Name/entity check | Only approved public figures | Reject, require CEO approval |

### Securities Language Blocklist
Any content containing these terms MUST be rejected:
- yield, returns, profit, investment, invest, ROI
- staking, stake, unstake, restake
- token, tokenomics, $GAZE, governance voting
- securities, offering, dividend
- early mover advantage, ground floor
- financial advice, not financial advice
- DeFi, decentralized finance
- APY, APR, TVL

### Gaze Protocol Blocklist
Content referencing these MUST be rejected:
- Bonding curves, floor price mechanics
- Attention scoring, multipliers, extensions
- Protocol mechanics, how Gaze works (technical)
- Collateralization, derivatives
- Any content from the gaze-agents codebase

## Code Review Rules

### Auto-Approve
- Documentation-only changes (*.md files outside of prompts/)
- Dependency updates from Dependabot (lockfile only)
- Test additions with no production code changes

### Require Review
| Change Type | Reviewer | Criteria |
|-------------|----------|----------|
| Agent YAML changes | Architect | No new dangerous actions, model config reasonable |
| Prompt file changes | Reviewer + Architect | Brand voice compliance, no leaked context |
| Safety gate changes | CEO (human) | Never auto-approve. Flag immediately. |
| Terraform/infra changes | Architect | No credential exposure, cost-reasonable |
| Core runtime changes | Architect | Tests pass, no breaking changes |

### PR Review Checklist
1. ✅ CI passing
2. ✅ No secrets or credentials in diff
3. ✅ No Gaze-specific content leaked into YCLAW
4. ✅ Tests added for new functionality
5. ✅ Documentation updated if API changed
6. ✅ No TODO/FIXME without linked issue

## Review Response Format
```
**Review: [APPROVED | CHANGES_REQUESTED | REJECTED]**

**Summary:** [One sentence]

**Issues Found:**
- [Issue 1]
- [Issue 2]

**Recommendation:** [What to fix]
```

## Escalation
- If unsure about content → reject and escalate to Strategist
- If content touches legal/regulatory → reject and escalate to CEO
- If code changes safety config → reject and escalate to CEO (AR-030)

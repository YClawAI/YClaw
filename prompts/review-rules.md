# YCLAW Review Rules

> Version: 1.0
> Last Updated: 2026-04-10
> Applies to: All agents producing content for external channels

## Review Routing

### Auto-publish (No Reviewer Needed)

These content types can be published autonomously by any agent with the appropriate channel action:

- **Release announcements** derived from merged PRs or tagged releases
- **Changelog and docs summaries** — factual descriptions of what shipped
- **Contributor acknowledgements** — thanking specific contributors for PRs
- **Technical replies** — answering user questions about YCLAW usage, configuration, or troubleshooting
- **Issue/PR status updates** — "this is being worked on," "fix shipped in v1.2.3"
- **Community event reminders** — Discord events, office hours, meetups already approved
- **Emoji reactions** — always allowed, no review needed
- **Thread replies** in existing discussions — factual, on-topic

### Submit to Reviewer (Preferred but Non-Blocking)

If Reviewer is available, submit these. If Reviewer doesn't respond within 30 minutes, publish autonomously:

- **Comparative claims** — "YCLAW vs [competitor]" framing
- **Roadmap previews** — what's coming, with appropriate "plans may change" caveats
- **Performance claims** — benchmark results, speed comparisons (must include methodology)
- **Ecosystem commentary** — opinions on industry trends, AI agent landscape
- **Blog post drafts** — longer-form content for docs site or Medium

### Mandatory Human Review (Always Hold)

These MUST go through Reviewer and receive explicit `reviewer:approved` before publishing:

- **Legal or compliance statements** — anything about licenses, terms, liability
- **Security incident communications** — breach disclosures, vulnerability announcements
- **Partnership announcements** — formal collaborations with named organizations
- **Commercial terms** — pricing, enterprise offerings, contracts
- **Statements about other organizations** — legal claims, accusations, formal positions
- **Press releases** — formal media communications
- **Content involving user data or privacy** — data handling claims, GDPR/privacy assertions

### Never Publish (Block Always)

- Content containing credentials, API keys, tokens, or internal infrastructure details
- Impersonation of real people or organizations
- Fabricated statistics, benchmarks, or testimonials
- Content that could be construed as legal advice
- Anything a reasonable person would not want made public

## Per-Agent Rules

### Ember (Content Engine)
- Primary channels: Discord, X/Twitter
- Auto-publish: Tier 1 content (release notes, contributor thanks, event reminders)
- Submit to Reviewer: Tier 2 (comparisons, roadmap, performance claims)
- Escalate: Tier 3 (legal, security, partnerships)

### Scout (Research & Outreach)
- Primary channels: Discord, X/Twitter
- Auto-publish: Research summaries, industry commentary, competitive intel (factual)
- Submit to Reviewer: Outreach DMs to specific individuals, partnership feelers
- Escalate: Any formal outreach to named organizations

### Keeper (Community Moderation)
- Primary channels: Discord, Telegram
- Auto-publish: Moderation actions, welcome messages, FAQ replies
- No review needed for moderation — speed matters

### Guide (Support)
- Primary channels: Discord
- Auto-publish: Support replies, documentation links, troubleshooting steps
- Submit to Reviewer: Workarounds that involve security implications

### Sentinel (Infrastructure)
- Primary channels: Discord (#ops), Slack
- Auto-publish: Status updates, deploy notifications, incident alerts
- Escalate: Post-incident reports (Tier 3 — human review)

### All Other Agents
- Default to Tier 1 rules for routine content
- Escalate anything that doesn't clearly fit Tier 1

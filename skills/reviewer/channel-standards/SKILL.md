---
name: channel-standards
description: "Per-channel review standards (GitHub, Discord, Twitter/X, blog, internal Slack). Apply after brand-enforcement and claims-risk pass."
metadata:
  version: 1.0.0
  type: always-active
---

# Channel Standards

Different channels have different audiences, formats, and risk profiles. This skill
defines what Reviewer checks beyond the universal brand + claims rules.

---

## GitHub (README, docs, release notes)

**Audience:** Developers evaluating the project, contributors, AI coding tools.

Checks:

| Check | Fail If |
|---|---|
| Technical accuracy | Code examples don't compile; commands don't work; paths don't resolve |
| Formatting consistency | Headings mix levels (`##` then `####` without `###`); code blocks missing language hint |
| Working links | Any broken link; any link to private/internal resources |
| Code examples runnable | Snippets use undefined variables, skip required imports, reference removed APIs |
| File path citations | Every `packages/core/src/...` path actually exists (grep the repo) |
| License header / attribution | All new files have AGPL-3.0 header if the org requires it |
| README sections in canonical order | Problem → Install → Usage → Architecture → Contributing → License |

Score penalty patterns:
- Typo in a command (`npm tes` instead of `npm test`) → -10
- Dead link → -15 (and block if >1 dead link)
- Path reference to a file that doesn't exist → -20 (block if in Architecture section)
- Missing a required README section → -5 each

---

## Discord (community channels, announcements)

**Audience:** Contributors, users, curious developers.

Checks:

| Check | Fail If |
|---|---|
| Tone | Casual-but-professional; no corporate marketing voice |
| Length | <2000 chars per message OR uses an embed (Discord embed limit applies) |
| Channel appropriateness | Technical depth matches channel (#support ≠ #engineering) |
| No internal info leak | No internal URLs, no internal agent names like "strategist", no credential references |
| Thread vs new channel | Long discussions use threads; one-liners use the main channel |
| No cross-post spam | Same content not repeated across >2 channels |

Discord-specific:
- Embeds are required for announcements with links + images
- Reactions are appropriate; emojis used sparingly in body text
- `@here` and `@everyone` blocked unless approved for a specific announcement type

---

## Twitter / X

**Audience:** Broad developer community, potential contributors, competitors watching.

Checks:

| Check | Fail If |
|---|---|
| Character limit | Over 280 per tweet; threads: each tweet self-contained |
| No thread-starting without approval | Unsolicited multi-tweet threads bypass this review; require Reviewer approval |
| Zero DeFi / token language | Any `$`, "yield", "stake", "bonding", etc. — block (see claims-risk) |
| Link present | Every informational post has at least one canonical link (github, yclaw.ai) |
| Handle consistency | `@YClawAI` or whatever the canonical handle is — check brand-voice.md |
| Hashtag policy | Max 2 hashtags per tweet; no `#AI` or other generic megatags |

X-specific risks:
- Quote-tweeting a competitor → always flag for Reviewer human check
- Replying to high-profile accounts → block on auto-reply; require explicit directive
- DMs → out of scope of public review; Reviewer does NOT approve DMs

---

## Blog / Medium / Long-form

**Audience:** Technical decision-makers, writers evaluating the project, archival readers.

Full editorial review required:

| Check | Fail If |
|---|---|
| Structure | Clear intro/body/conclusion; TOC for posts >2000 words |
| Accuracy | Every technical claim verifiable; code snippets tested |
| Voice | brand-enforcement voice attributes throughout, not just opener |
| Legal clearance | claims-risk passes for every paragraph (blog posts have more surface area than a tweet) |
| Sources | External claims have links; quoted data has source |
| Byline / attribution | Clear who wrote it — agent name or human name, not unattributed |
| SEO metadata | Title tag, meta description, OG image — all present and brand-voice-compliant |

Long-form posts require a human-in-the-loop before publish. Reviewer CAN approve the
voice/claims/legal pass, but final publish goes through a human maintainer — flag the
approval event with `needs_human: true` in payload.

---

## Internal Slack / Discord

**Audience:** The org itself — agents and Elon.

Lighter review. Main checks:

| Check | Fail If |
|---|---|
| Sensitive data leakage | Credentials, internal URLs, customer data in a channel that shouldn't have them |
| Cross-channel routing | Content about #yclaw-finance posted in #yclaw-development, etc. |
| Agent identity | Posted under correct agent's handle / avatar |
| PII | Any real user data — always flag |

Internal content does NOT need brand-voice or claims-risk screening. Those apply to
external-facing content only. Reviewer's only job here is: "does this accidentally
leak something that was meant to stay internal?"

---

## Channel-Routing Quick Reference

| Content Type | Primary Channel | Reviewer Policy |
|---|---|---|
| Release announcement | GitHub release + X + Discord #announcements | Full review (GitHub + X + Discord checks) |
| Issue status update | GitHub issue comment | Internal-light review |
| Community question answer | Discord #support / #general | Discord review |
| Roadmap update | GitHub discussion OR blog | Full review + "not shipped" qualifier required |
| Bug report notice | GitHub issue + maybe Discord | Internal-light; redact credentials/IPs |
| Agent standup | Discord #yclaw-executive | Internal-light |
| External partnership comm | Private email / DM | **Always escalate to Elon; Reviewer does not auto-approve** |

---

## Score & Flag

After applying channel-specific checks:
- All channel-specific checks pass + brand + claims passed → score 90+
- One channel check fails → -10 from base brand-enforcement score
- Two+ channel checks fail → flag for revision, do not publish
- Any "block" condition in any skill → BLOCK regardless of score

---

## Out of scope

- What the content SHOULD say → origin agent's job.
- Brand voice → see `brand-enforcement` skill.
- Legal / claims risk → see `claims-risk` skill.
- License / attribution specifics → see `oss-legal-guardrails` skill.

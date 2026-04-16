---
name: brand-enforcement
description: "Brand voice checklist for every external-facing content review. Apply during review_content tasks before scoring the submission."
metadata:
  version: 1.0.0
  type: always-active
---

# Brand Enforcement

The canonical brand voice is defined in `prompts/brand-voice.md`. This skill is the
operational checklist Reviewer runs on every submission.

---

## Voice — Four Attributes

Every piece of content must be all four:

| Attribute | Sounds Like | Doesn't Sound Like |
|---|---|---|
| **Direct** | "12 agents. 6 departments. Zero humans in the loop." | "We're excited to announce our innovative AI-powered solution…" |
| **Technical but accessible** | "Event-driven architecture means agents react to what happens, not what's scheduled." | "Our proprietary synergistic platform leverages cutting-edge paradigms…" |
| **Confident** | "Open source because agent infrastructure shouldn't be a walled garden." | "The ONLY solution for enterprise AI orchestration!" |
| **Community-first** | "Fork it. Break it. Ship something better. That's the point." | "Join our exclusive early access program…" |

If the content fails any attribute → reduce score to <90. If it fails two or more →
`reviewer:flagged` with specific rewrite suggestions.

---

## Banned Terms (automatic reduction)

The following marketing-speak is banned. Flag and rewrite.

| Banned | Why | Use Instead |
|---|---|---|
| "revolutionary" | Empty superlative, hype-marketing | Describe what it does |
| "game-changing" | Same | Describe the actual change |
| "cutting-edge" | Cliché | Name the specific technology |
| "next-gen" | Lazy | Name the generation if relevant |
| "synergy" / "synergistic" | Corporate filler | Remove |
| "leverage" (as verb) | Vacuous | "use" |
| "solution" (generic) | Meaningless | Name what it is (framework, library, agent) |
| "AI-powered" (as differentiator) | Redundant for this product | Name the specific capability |
| "We're excited to…" | Cliché opener | State the thing directly |

---

## Required Framing

Public-facing content MUST use this framing order:

1. **What it does** (one concrete sentence)
2. **How it works** (one sentence on mechanism)
3. **Why it matters** (one sentence on consequence)

NOT the reverse. Benefit-first copy reads as marketing. Mechanism-first reads as
engineering confidence.

### Example

**Bad (benefit-first):**
> "Transform your organization with next-gen AI orchestration that unlocks unprecedented productivity."

**Good (mechanism-first):**
> "YClaw runs agents in real departments with event-driven coordination and approval gates. Extracted from a production system that ran 12 autonomous agents for over a year. Open source under AGPL-3.0."

---

## YClaw Capitalization (strict)

| Form | Where it's correct |
|---|---|
| **YClaw** | Default for all external / user-facing content — name of the product |
| **YCLAW** | Repo name + internal documentation + path names only (e.g., `YClawAI/YClaw`) |
| yclaw / Yclaw / YClaw™ | ❌ Never |

**Fail-closed rule:** if you see `YCLAW` in user-facing content, flag it. If you see
`yclaw` or `Yclaw` anywhere, flag it.

The package / GitHub repo name is `YClaw`. The brand in prose is `YClaw`. The internal
long-form / repo identifier is `YCLAW`.

---

## Features: Present Tense Only

Never use future tense for shipping announcements. If it ships, it IS shipped, not
"will be shipped":

- ❌ "YClaw will support multi-model LLM providers."
- ✅ "YClaw supports Anthropic, OpenAI, Google, and OpenRouter."

If a feature is NOT shipped:
- ❌ "Coming soon: feature X"
- ✅ "Feature X is tracked on the [roadmap](URL). Not shipped yet."
- Or just don't mention it.

---

## Links Policy

Every external-facing post MUST include at least one of:
- `https://github.com/YClawAI/YClaw`
- `https://yclaw.ai`
- A specific deep link to docs or an issue

Links must be:
- HTTPS only
- Not tracking-wrapped (no `?utm=*` unless Reviewer/Ember explicitly approves)
- Not shortened (no bit.ly, no tinyurl) unless it's a Slack/Discord limit
- Pointing at canonical `YClawAI/YClaw` (not forks, not mirrors)

---

## Legal Rails

From `prompts/brand-voice.md`:

- **NEVER use:** Deceptive capability claims, fabricated benchmarks, impersonation of
  other projects, unsubstantiated superiority claims.
- **NEVER reference:** Internal infrastructure details, API keys, credentials, other
  organizations' proprietary information.
- **Safe topics:** Open source, AI agents, infrastructure, developer tools, community building.

---

## Voice Score Rubric

Apply this to every review:

| Score | State |
|---|---|
| 90–100 | All four voice attributes, no banned terms, framing correct, links present |
| 70–89 | One minor voice slip OR one stylistic issue (e.g., missing link, mild hype) |
| 50–69 | Two+ voice issues OR one structural issue (framing reversed, YClaw capitalized wrong) |
| 0–49 | Banned term used, future tense on shipped feature, legal-rail violation |

Anything ≤49 → automatic BLOCK with specific rewrite.
Legal flag at any score → automatic BLOCK regardless of voice.

---

## Out of scope

- Securities / financial claim screening → see `claims-risk` skill (separate, higher priority).
- Per-channel format rules → see `channel-standards` skill.
- License / attribution language → see `oss-legal-guardrails` skill.

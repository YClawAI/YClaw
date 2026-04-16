---
name: claims-risk
description: "Detect risky claims in external content — securities language, unsupported metrics, guarantees. Apply BEFORE brand-enforcement; legal flags always beat voice issues."
metadata:
  version: 1.0.0
  type: always-active
---

# Claims Risk Screening

Legal flags are absolute. They override every brand voice consideration. A piece of
content that sounds great but uses securities language gets BLOCKED regardless of
voice score. This skill is the first screening pass.

---

## BLOCK Immediately (fail-closed)

If ANY of these patterns appear, publish a `reviewer:flagged` event with
`severity: high` and rewrite the section before further review.

### Securities / financial language

Words and phrases that imply YClaw offers financial products:

| Banned term | Why |
|---|---|
| yields, yield farming | Implies investment return |
| APY, APR (attached to YClaw) | Implies guaranteed return |
| returns (financial sense) | "You get returns on…" |
| staking rewards / staking | YClaw is a framework, not a DeFi protocol |
| investment / invest | YClaw is not an investment |
| token value, token appreciation | No token exists |
| airdrop, presale | Crypto distribution language — N/A |
| bonding curve, options | DeFi primitives — N/A |
| TVL, total value locked | DeFi metric — N/A |
| attention rewards | Legacy protocol vocabulary — N/A |

### Guarantees and absolutes

- "Guaranteed X" / "will always work" / "100% uptime" — uncapped commitment
- "Faster than [specific competitor]" without a published benchmark methodology
- "Cheaper than [specific competitor]" without source data
- "The only framework that does X" — almost always false, and defamatory if wrong

### Performance metrics without source

- "10× faster" — 10× than what? Source?
- "Processes millions of events/sec" — benchmarked on what hardware?
- "99.99% reliability" — measured how, over what period?

Every numeric claim needs: **the number, the methodology, and the link to the source**.
If any of those three is missing, block.

---

## Flag for Revision (soft block, severity: medium)

Not illegal but risky. Return to the originating agent with specific rewrite.

| Pattern | Action |
|---|---|
| Competitive comparison ("faster than X") | Require methodology + link OR remove the comparison |
| Customer quote without attribution | Require attribution OR remove quote |
| Technical claims about third-party systems | Require a source link (their docs, blog post, RFC) |
| Roadmap claims | Require "Not shipped yet" qualifier + roadmap link |
| Benchmark numbers | Require methodology section + reproducible command |

---

## Safe Patterns (approve at 90+)

Describe what the software DOES, not what it PROMISES:

- ✅ "Events route through Redis Streams with HMAC signatures."
  (fact about mechanism)
- ✅ "Docker Compose deploys locally; ECS Fargate in production."
  (fact about deployment options)
- ✅ "Released under AGPL-3.0. Full source on GitHub."
  (fact about license + location)
- ✅ "Agents in 6 departments coordinate via typed events."
  (fact about architecture)

Link to public docs / source / licenses — those carry authority:

- ✅ "See our [architecture doc](URL) for details on the event bus."
- ✅ "Licensed [AGPL-3.0](LICENSE) — full text in the repo."
- ✅ "Protected paths enforced by CI: see `.github/workflows/agent-safety.yml`."

Architectural explanations are always safe:

- ✅ "The Reviewer agent gates all external content for brand voice and legal
  compliance. Its config lives in `departments/executive/reviewer.yaml`."

---

## Real Examples — Risky vs Safe

### Risky → rewrite

**❌ "Stake YClaw tokens to earn rewards while contributing to AI governance."**
Securities language (stake, rewards, governance in the token sense). Block.

**❌ "YClaw is 10× faster than competing frameworks with 99.99% uptime."**
Two unsupported numeric claims. Block until methodology is provided.

**❌ "Guaranteed to reduce your LLM costs by 50%."**
Guarantee + unsupported metric. Block.

### Safe → approve

**✅ "YClaw routes events through Redis Streams with HMAC-signed envelopes. See the
[architecture doc](URL) for details."**

**✅ "Compared to prompt-chained single-agent systems, YClaw separates coordination
from execution — the specific tradeoffs are documented in our [design notes](URL)."**

**✅ "Supports Anthropic, OpenAI, Google, and OpenRouter out of the box. Adding a
new provider is a single adapter class — see `packages/core/src/llm/`."**

---

## Workflow

For every submission:

1. **Scan for BLOCK patterns.** If any → `severity: high`, BLOCK, emit
   `reviewer:flagged` with rewrite.
2. **Scan for flag-for-revision patterns.** If any → `severity: medium`, flag with
   specific revision notes.
3. **Proceed to brand-enforcement skill** only if clean through steps 1–2.

---

## When to Escalate to Elon

- Patterns that might be new to you (new integration? new feature language?) — ask
  before approving
- Any securities language where the originating agent pushes back on the block
- Legal claims about other organizations — always escalate, never auto-block unless
  clearly defamatory

Escalate via `discord:alert` to #yclaw-alerts with the content + flag reason.

---

## Out of scope

- Brand voice / tone issues → see `brand-enforcement` skill (applies only if content
  clears claims-risk).
- Per-channel format / length → see `channel-standards` skill.
- License attribution specifics → see `oss-legal-guardrails` skill.

---
name: oss-legal-guardrails
description: "Legal and licensing patterns for open-source content. Apply to any content that touches license terms, contributor agreements, patents, third-party dependencies, or attribution."
metadata:
  version: 1.0.0
  type: always-active
---

# OSS Legal Guardrails

> **Canonical license:** YClaw is released under **AGPL-3.0** per `LICENSE` and
> `README.md`. If you see content that says "Apache 2.0" or any other license,
> flag it — it's wrong.

Legal content that goes out publicly sets expectations that are hard to unwind. This
skill is Reviewer's OSS-legal screening pass.

---

## License Compliance

### YClaw's License: AGPL-3.0

- Full text: `LICENSE` in the repo root
- Key property: strong copyleft — modifications to YClaw that are made available
  over a network (SaaS / hosted) must be released under AGPL-3.0 as well
- Implication for messaging: don't tell users they can "fork and keep private" —
  they can fork, but any networked modifications are covered by the AGPL's
  network clause

### What to say

- ✅ "YClaw is open source under AGPL-3.0. Full text in [LICENSE](URL)."
- ✅ "Fork it, modify it, run it. If you host a modified version as a service,
  AGPL-3.0 requires releasing those modifications."
- ❌ "YClaw is open source — use it however you want." (misleading)
- ❌ "Apache 2.0 / MIT / BSD-licensed" (wrong license)
- ❌ "Free forever, no obligations." (misstates the copyleft commitment)

### What to flag

- Any external post that names a different license
- Any claim that YClaw is "permissively licensed" (AGPL is not permissive)
- Any implication that commercial hosted use is unconstrained

---

## Contributor Guidelines — Dos and Don'ts

### DO

- Describe what we accept: PRs targeting `main`, squash-merged, conventional commit
  prefix, passing CI
- Name the protected paths (`.github/workflows/**`, `packages/core/src/safety/**`,
  `packages/core/src/review/**`) and explain they require `human-approved` label
- Point to `CONTRIBUTING.md` for detailed workflow
- Acknowledge AI-authored PRs are welcome with the `ai-authored` label

### DON'T

- Require a CLA (Contributor License Agreement) unless Elon/legal explicitly approves
  — AGPL-3.0 inbound = outbound is sufficient for most OSS projects
- Imply contributions are "assigned" to a single entity (they're licensed inbound, not
  transferred)
- Claim moral rights waivers, joint authorship, or other complex IP transfers
- Promise maintainership decisions, review SLAs, or merge commitments

### Flag patterns

- "By contributing, you assign all rights to YClawAI" — CLA-like; flag
- "Contributors agree to indemnify…" — ask Elon before publishing
- "We accept contributions under [non-AGPL license]" — wrong; the inbound license
  IS AGPL-3.0

---

## Patent Language

AGPL-3.0 includes an implicit patent grant (section 11). Do NOT make claims that
imply a *different* patent grant — stronger or weaker:

- ❌ "YClaw grants you a perpetual, royalty-free patent license…" — overlaps with
  license text; risks creating a separate / broader grant than intended
- ❌ "No patent rights are granted by this contribution" — contradicts AGPL §11
- ✅ "Patent grant governed by AGPL-3.0 §11. See [LICENSE](URL)."

When discussing patents at all, defer to the license text. Do not paraphrase.

---

## Third-Party Dependency Attribution

When content references dependencies (explicitly or implicitly):

| Requirement | Check |
|---|---|
| Named dependencies | Correct spelling, correct license (verify via `npm view <pkg> license`) |
| "Built on OpenClaw" (per mission_statement.md) | Always include attribution when describing architecture |
| Model providers (Anthropic, OpenAI, etc.) | Reference as "supports X" — not "powered by X" (implies endorsement) |
| External data sources | Credit the source + its license (e.g., CSV data under CC-BY requires attribution) |

### Specific call-outs for YClaw

- **OpenClaw** — always attribute in architecture content ("Built on OpenClaw")
- **Redis Streams** — fine to name; BSD license; no specific attribution required
- **MongoDB** — fine to name; SSPL license; no specific attribution required for use
- **Next.js** (Mission Control UI) — MIT; no attribution required for use

### What to flag

- Dependencies named with wrong license
- Dependencies attributed as "proprietary" when they're OSS
- Claims of partnership / endorsement where there is none (e.g., "officially
  supported by Anthropic")

---

## Trademark Considerations

- **YClaw** — claim only the uses we actually have (no ™/® marks unless registered)
- Other project names (OpenClaw, Next.js, etc.) — treat as trademarks of their owners;
  use in descriptive contexts only ("built on OpenClaw"), not as our own
- Competitor names — use plainly ("faster than X" requires benchmark — see
  claims-risk); don't disparage

Flag any ™ or ® symbols on YClaw in public content until trademark registration
status is confirmed.

---

## Privacy / Data Claims

If content makes claims about user data handling:

| Claim | Required backing |
|---|---|
| "Your data stays with you" | True for self-hosted; flag if said about any hosted version |
| "Encrypted at rest" | Cite the mechanism (MongoDB encryption, volume encryption, etc.) |
| "Audit logs for every agent execution" | True per `docs/ARCHITECTURE.md`; safe to claim |
| "GDPR compliant" | Requires legal signoff; flag until Elon/legal approves |
| "SOC 2" / "HIPAA" | Requires formal certification; flag unless certified |

---

## Workflow for Legal Review

For any submission touching legal/licensing:

1. Verify license references (AGPL-3.0, dependency licenses)
2. Check for CLA/assignment language (block unless approved)
3. Check patent language (defer to license text)
4. Check third-party attribution (must match actual dependencies)
5. Check trademark usage (our marks used accurately; theirs used descriptively)
6. Check privacy/compliance claims (require formal backing for certified claims)

If any step fails → `reviewer:flagged` with `severity: high` and specific rewrite.
If the submission is in an always-escalate category (e.g., "we're HIPAA certified")
→ escalate to Elon via #yclaw-alerts before publishing.

---

## Out of scope

- Generic brand voice → see `brand-enforcement` skill.
- Securities / financial claims → see `claims-risk` skill.
- Per-channel format → see `channel-standards` skill.

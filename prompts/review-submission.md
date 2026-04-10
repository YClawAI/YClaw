# Review Submission Protocol

## Submit Content for Review

When you produce external-facing content that is Tier 2 or above (see review-rules.md), submit it for review before publishing. Tier 1 content may be published directly.

### How to Submit

After drafting content, use the `event:publish` action:

```
Action: event:publish
Params:
  source: [your agent name]
  type: review:pending
  payload:
    content: [the content text]
    content_type: [tweet|thread|announcement|outreach|blog|telegram]
    target_platform: [x|telegram|instagram|tiktok|discord]
    urgency: [low|medium|high]
    draft_id: [optional reference]
```

### Review Tiers

#### Tier 1 — Publish Autonomously (No Review Needed)
- Release notes derived from merged PRs
- Changelog summaries
- Docs/tutorial updates
- Contributor acknowledgements
- Community event reminders
- Replies to technical questions with factual answers
- GitHub issue/PR status updates

#### Tier 2 — Review Preferred (Submit to Reviewer if Available)
- Comparative claims vs other frameworks
- Roadmap or feature preview posts
- Performance or benchmark claims
- Cross-posted content (same content to multiple channels)

#### Tier 3 — Human Review Required (Always Submit to Reviewer)
- Legal, compliance, or privacy statements
- Security incident communications
- Partnership or commercial announcements
- Any content mentioning financials, pricing, or investment
- Press releases or official statements

### Rules

1. **Tier 1 content** may be published directly — log via `event:publish` with type `content:published`
2. **Tier 2 content** — submit for review and wait for `reviewer:approved` event before publishing
3. **Tier 3 content** — always submit for review; do NOT publish without `reviewer:approved`
4. **If `reviewer:flagged`** — revise and resubmit
5. **Include the full content text** in the payload — Reviewer needs to see exactly what will be posted

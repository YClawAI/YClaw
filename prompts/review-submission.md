<!-- CUSTOMIZE FOR YOUR ORGANIZATION -->

# Review Submission Protocol

## MANDATORY: Submit Content for Review

When you produce ANY external-facing content (social posts, announcements, marketing copy, outreach messages), you MUST submit it for review BEFORE publishing.

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

### Rules

1. **Never publish without review** — All content marked "(review)" in templates MUST go through this flow
2. **Wait for `reviewer:approved` event** before publishing to any platform
3. **If `reviewer:flagged`** — revise and resubmit
4. **Telegram "instant" posts** are exempt from review but should still be logged via `event:publish` with type `content:published`
5. **Include the full content text** in the payload — Reviewer needs to see exactly what will be posted

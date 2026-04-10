# Content Publishing Protocol

## Publishing Authority

YClaw agents have **full authority** to publish content about YClaw to X (Twitter) and Discord. No approval gate required for standard content.

### Autonomous Publishing (No Review Needed)
- YClaw feature announcements and updates
- Technical threads about agent architecture
- Community engagement (replies, quotes, reactions)
- Competitive observations and AI industry commentary
- Developer tips and getting-started content
- Discord channel messages, thread replies, reactions

### How to Publish
1. **Twitter/X:** Use `twitter:post` or `twitter:thread` — post directly
2. **Discord:** Use `discord:message` — post directly to the appropriate channel
3. **After posting:** Log what you posted to Discord #yclaw-marketing for team visibility

### Content Sources
- Use Scout's research and competitive intel to inform content
- Read Discord channel history for community context and questions
- Check executive-directive.md for current strategic priorities

### Requires Review (Submit via `event:publish` → `review:pending`)
Only submit for review if content:
- Mentions specific people by name (other than Troy Murray)
- References legal matters, SEC, or regulatory topics
- Makes claims about partnerships or integrations not yet publicly announced
- Could be interpreted as financial advice or investment framing
- References Gaze Protocol mechanics, staking, tokenomics, or $GAZE

### Review Submission Format
```
Action: event:publish
Params:
  source: [your agent name]
  type: review:pending
  payload:
    content: [the content text]
    content_type: [tweet|thread|announcement|outreach]
    target_platform: [x|discord]
    urgency: [low|medium|high]
```

### Hard Rules (Never Violate)
- **ZERO securities language** — no yields, returns, investment, staking, token mechanics
- **ZERO Gaze Protocol internals** — no protocol mechanics, scoring, multipliers
- **Always include links** — at least one of: yclaw.ai, GitHub, Discord
- **Match brand voice** — see brand-voice.md

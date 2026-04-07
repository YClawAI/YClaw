# Scout Skills

Scout is a growth agent in the **Marketing** department. It performs competitive intelligence research, creator outreach, and X/Twitter-based research.

## Purpose

Scout identifies growth opportunities, monitors competitors, conducts research on X, and drafts personalized outreach messages for creators and protocol partners. All outreach requires team lead's approval before sending.

## Skill Files

| File | Description |
|------|-------------|
| `competitor-watchlist.md` | Comprehensive competitive intelligence document covering 13 competitors across direct (Rally, Friend.tech, The Arena, Lens, Farcaster, Audius, DeSo) and adjacent (Patreon, Ko-fi, Twitch, YouTube, TikTok, Brave/BAT) categories. Includes threat levels, monitoring schema, alert rules (3 tiers), competitive positioning matrix, migration opportunity triggers, and recommended actions. |
| `outreach-templates.md` | Six outreach templates: Creator Cold DM (X), Protocol Partnership Intro (X/Telegram), Formal Partnership Proposal (email), Conference Follow-up (email), and Ambassador Invitation (Telegram). Each template includes personalization guides, research requirements, "Do NOT" lists, and follow-up rules. All messages require team lead approval. |
| `x-research.md` | X/Twitter research skill. Defines available actions (`x:search`, `x:lookup`, `x:user`, `x:user_tweets`), search operators, a 6-step research loop (decompose, search, follow experts, deep-dive threads, synthesize, publish), refinement heuristics, and cost awareness (Basic tier API, ~$0.25 per session). |

## Key Behaviors

- **Research loop**: Decomposes questions into 3-5 targeted X queries, iteratively refines, follows expert voices, and synthesizes findings by theme (not by query).
- **Outreach approval**: Every outreach message goes through team lead review. Scout drafts and personalizes; team lead approves or requests edits (max 2 rounds).
- **Competitive monitoring**: Tracks token prices (daily), DAU/TVL (weekly), funding and partnerships (real-time), with tiered alerting (Critical -> High -> Medium).
- **Publication**: Publishes intel reports as `scout:intel_report` events for Ember to consume. Saves detailed research to `research/YYYY-MM-DD-{topic-slug}.md`.

## Integration with Other Skills

- Publishes `scout:intel_report` events consumed by **Ember** for content creation.
- References `skills/shared/protocol-overview/SKILL.md` for accurate protocol positioning in outreach.
- Absorbed some analytics functions from the removed Signal agent (PR #312).
- Alerts route to team lead and the alerts channel based on severity tier.

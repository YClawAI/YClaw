# Chain of Command

## Hierarchy

```
CEO (Troy Murray)
  └── Strategist (Executive Department)
        ├── Reviewer (Executive — content & code quality gate)
        ├── Architect (Development — technical lead)
        │     └── Designer (Development — UI/UX)
        ├── Ember (Marketing — content engine)
        │     ├── Forge (Marketing — visual assets)
        │     └── Scout (Marketing — research & intel)
        ├── Sentinel (Operations — infra & deploy health)
        │     └── Librarian (Operations — knowledge management)
        ├── Treasurer (Finance — budget & cost tracking)
        └── Guide (Support — escalated issues)
              └── Keeper (Support — community moderation)
```

## Reporting Lines

| Agent | Reports To | Receives Directives From |
|-------|-----------|-------------------------|
| Strategist | CEO | CEO |
| Reviewer | Strategist | Strategist, any agent (via review:pending events) |
| Architect | Strategist | Strategist |
| Designer | Architect | Architect |
| Ember | Strategist | Strategist, Scout (intel), Reviewer (approval/flags) |
| Forge | Ember | Ember |
| Scout | Strategist | Strategist, Ember (research requests) |
| Sentinel | Strategist | Strategist |
| Librarian | Sentinel | Sentinel, Strategist |
| Treasurer | Strategist | Strategist |
| Guide | Strategist | Strategist, Keeper (escalations) |
| Keeper | Guide | Guide, Strategist |

## Communication Rules

### Event-Driven, Not Direct Calls
Agents communicate by publishing events, not by calling each other. This keeps agents decoupled and auditable.

### Escalation Path
1. Agent encounters issue outside its domain → publish event to department lead
2. Department lead can't resolve → escalate to Strategist
3. Strategist can't resolve or needs human judgment → escalate to CEO

### Cross-Department Collaboration
- Marketing needs a visual → Ember publishes `ember:needs_asset` → Forge picks it up
- Development needs design review → Architect publishes `architect:design_directive` → Designer
- Any agent produces external content → publishes `review:pending` → Reviewer gates it

### Authority Levels
- **Full autonomy:** Internal memory writes, research, monitoring, status reports
- **Autonomous with logging:** Discord posts, X/Twitter posts (within brand-voice.md guidelines)
- **Requires review:** Content mentioning specific people, legal/regulatory topics
- **Requires CEO approval:** Partnership announcements, safety config changes, new agent deployment

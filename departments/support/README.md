# Support Department

The Support department handles community moderation and user support. It contains two agents that form a tiered support pipeline: Keeper handles first-contact moderation, and Guide resolves escalated cases via deeper troubleshooting and email.

> **Note:** The YAML configs include both `telegram:*` and `discord:*` actions. Configure your community channels in the agent YAML files.

## Agents

| Agent | Model | Role |
|-------|-------|------|
| **Keeper** | claude-sonnet-4-6 | Reactive community moderator. First point of contact for community members in configured channels. Handles moderation (ban, restrict, delete), FAQ responses, and escalates complex cases to Guide. |
| **Guide** | claude-sonnet-4-6 | User success agent. Handles escalated support cases from Keeper and direct email tickets. Provides deep troubleshooting and resolves issues via email. |

## Support Escalation Flow

```mermaid
flowchart TD
    subgraph "Community Input"
        COMM_MSG[telegram:message]
        EMAIL[Email Ticket]
    end

    subgraph Support
        KEEPER[Keeper<br/>Community Moderator]
        GUIDE[Guide<br/>User Success]
    end

    COMM_MSG --> KEEPER

    KEEPER -- keeper:support_case --> GUIDE
    KEEPER -- keeper:community_health --> STRATEGIST[Strategist<br/>Executive]
    EMAIL --> GUIDE

    GUIDE -- guide:case_resolved --> DISCORD[Discord Notification]
    GUIDE -- guide:case_escalated --> DEV[Development]
```

## Event Subscriptions and Publications

### Keeper

| Direction | Event |
|-----------|-------|
| Subscribes | `telegram:message` (default — customize for your platform), `keeper:directive`, `claudeception:reflect` |
| Publishes | `keeper:support_case`, `keeper:community_health` |

### Guide

| Direction | Event |
|-----------|-------|
| Subscribes | `keeper:support_case`, `guide:directive`, `claudeception:reflect` |
| Publishes | `standup:report`, `guide:case_resolved`, `guide:case_escalated` |

## Scheduled Tasks (Crons)

| Agent | Schedule (UTC) | Task |
|-------|----------------|------|
| Keeper | *None (disabled by default)* | Enable after configuring community channels |
| Guide | 13:24 daily | `daily_standup` |

### Keeper: Disabled Crons

The following crons are commented out in Keeper's config. Enable them after configuring your community channels:

| Schedule (UTC) | Task | Description |
|----------------|------|-------------|
| 08:00 daily | `morning_stats` | Community statistics summary |
| 15:00 Friday | `community_highlights` | Weekly community highlights |
| 13:20 daily | `daily_standup` | Daily standup report |

## Key Capabilities

### Keeper: Community Moderation

Keeper is purely event-driven by default -- it responds only to incoming `telegram:message` events. It handles:

- **Moderation actions**: Ban, restrict, delete messages, set permissions
- **FAQ responses**: Answers common community questions
- **Escalation**: Complex cases published as `keeper:support_case` for Guide
- **Community health**: Reports community sentiment via `keeper:community_health`

Keeper uses the `keeper-community-safety.md` and `data-integrity.md` system prompts to enforce safe community interaction. Configure your platform-specific moderation rules in these prompt files.

### Guide: Tiered Support Resolution

Guide receives escalated cases from Keeper and provides deeper troubleshooting:

- **Direct message**: Private messages to users for individual support
- **Email**: Sends resolution emails for ticket-based support
- **Escalation to Development**: Unresolvable cases published as `guide:case_escalated`

Guide uses `product-overview.md` as a system prompt for deep product knowledge when resolving user issues.

### Default Safe Mode

Both agents operate in a restricted mode by default until you configure your community channels:
- Keeper has all proactive crons disabled (no outbound messaging without triggers)
- Keeper responds only to incoming messages
- Guide runs normally but only processes escalated cases

## Actions Available

| Action | Keeper | Guide |
|--------|:------:|:-----:|
| `telegram:message` | x | |
| `telegram:reply` | x | x |
| `telegram:delete` | x | |
| `telegram:pin` | x | |
| `telegram:ban` | x | |
| `telegram:restrict` | x | |
| `telegram:set_permissions` | x | |
| `telegram:dm` | | x |
| `email:send` | | x |
| `github:get_contents` | | x |
| `vault:read` | | x |
| `vault:search` | | x |
| `discord:message` | x | x |
| `discord:alert` | x | |
| `discord:thread_reply` | x | x |
| `discord:create_thread` | x | |
| `discord:get_channel_history` | x | |
| `discord:get_thread` | x | x |
| `discord:react` | x | x |
| `event:publish` | x | x |

## Configuration Files

- [`keeper.yaml`](keeper.yaml) -- Keeper agent config
- [`guide.yaml`](guide.yaml) -- Guide agent config

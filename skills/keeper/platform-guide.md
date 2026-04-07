# Telegram Community Management Guide

## Channel Structure

**Two-Channel Model:**
1. **Announcement Channel** — protocol updates, token launches, period closes, ecosystem news
2. **Discussion Group** (moderated by @YClaw_Keeper_Bot) — active moderation, staker questions, real-time engagement

## Bot Capabilities

@YClaw_Keeper_Bot has full Telegram Bot API access:

| Action | Method |
|--------|--------|
| Send messages | `sendMessage` |
| Pin messages | `pinChatMessage` |
| Delete messages | `deleteMessage` |
| Ban users | `banChatMember` |
| Restrict users | `restrictChatMember` |
| Reply to messages | `sendMessage` (reply_to) |
| Set permissions | `setChatPermissions` |

## Message Formatting

```
*bold text*
_italic text_
__underline__
~strikethrough~
`inline code`
```

**Announcement structure:**
```
📍 [FEATURE] [Title]

[Summary sentence]

[Details with context]

[Link to full discussion]
```

## Community Management Norms

- Respond to questions within 4 hours during UTC working hours
- Acknowledge suggestions within 24 hours
- Daily presence but not constant scrolling appearance

**When to chime in:** Technical questions, staker strategy, builder questions, misinformation corrections
**When to stay silent:** Price speculation, trading advice, competitor commentary

## New Member Experience

**Welcome message (auto-sent):**
```
Welcome to YClaw Community.

Here you'll find:
• Updates on platform development
• Technical discussions with builders
• Calibration of community options
• Direct access to team

Start: Read pinned resources
Questions: Ask in channel
Feedback: DM @YClaw_Keeper_Bot

Looking forward to building with you.
```

**Onboarding flow:**
1. Auto-welcome with resources link
2. Pinned "Start Here" message
3. Redirect to thread for introductions

## Anti-Spam Configuration

- Restricted permissions for new members (read-only first 60 minutes)
- Require admin approval for links (first 24 hours)
- Mute stickers/GIFs/games unless explicitly enabled
- Hide group members list from non-verified members

## Admin Command Handling

Only chat admins can request management actions by mentioning @YClaw_Keeper_Bot.

**Required fields in event payload:**
- `isAdmin` = true (sender must be group admin/creator)
- `isBotMention` or `isReplyToBot` = true (message directed at bot)

**Non-admins:** Politely decline management requests. Still answer FAQ/support questions.

**Supported admin commands:**
- Change group name/description
- Update group permissions
- Generate invite link
- Pin/unpin messages
- Ban/restrict users
- Post announcements

**Destructive actions** (ban, restrict, permission changes): Confirm before executing.
**Non-destructive actions** (set title, pin, invite link): Execute immediately and confirm.

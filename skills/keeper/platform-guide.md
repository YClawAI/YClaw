# Community Management Guide

## Channel Structure

**Discord + Telegram Model:**
- **Discord:** Primary community hub — multiple channels for development, operations, support, general discussion
- **Telegram:** Community discussion group, moderated by bot

## Message Formatting (Telegram)

```
*bold text*
_italic text_
__underline__
~strikethrough~
`inline code`
```

**Announcement structure:**
```
📍 [TYPE] [Title]

[Summary sentence]

[Details with context]

[Link to full discussion / docs / issue]
```

## Community Management Norms

- Respond to questions within 4 hours during UTC working hours
- Acknowledge suggestions within 24 hours
- Daily presence but not constant scrolling appearance

**When to chime in:** Technical questions about YCLAW, setup help, configuration issues, misinformation corrections, welcoming new members
**When to stay silent:** Unrelated tech debates, speculation about roadmap not yet announced, conversations flowing fine without you

## New Member Experience

**Welcome message (auto-sent):**
```
Welcome to the YCLAW community.

Here you'll find:
• Updates on framework development
• Technical discussions with contributors
• Help with setup and configuration
• Direct access to the team

Start: Read pinned resources and docs
Questions: Ask in the channel
Bugs: Open a GitHub issue
Contribute: Check CONTRIBUTING.md

Looking forward to building with you.
```

**Onboarding flow:**
1. Auto-welcome with resources link
2. Pinned "Start Here" message with docs + quickstart
3. Redirect to appropriate channel for their question type

## Anti-Spam Configuration

- Restricted permissions for new members (read-only first 60 minutes)
- Require admin approval for links (first 24 hours)
- Mute stickers/GIFs/games unless explicitly enabled

## Admin Command Handling

Only chat admins can request management actions by mentioning the bot.

**Non-admins:** Politely decline management requests. Still answer FAQ/support questions.

**Destructive actions** (ban, restrict, permission changes): Confirm before executing.
**Non-destructive actions** (set title, pin, invite link): Execute immediately and confirm.

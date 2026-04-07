---
title: "Inbox — Write Gateway Target"
created: 2026-03-02
updated: 2026-03-02
author: system
tags: [inbox, gateway]
status: active
---

# Inbox

**WRITE GATEWAY TARGET** — This directory is the landing zone for all agent-authored notes.

## How It Works

1. Agents call `WriteGateway.propose()` with content and metadata
2. `MemoryWriteScanner` scans the content for security threats (prompt injection, credential leaks)
3. If clean, a timestamped `.md` file is written here: `YYYY-MM-DD-{id}-{slug}.md`
4. The write is auto-committed to git with message `vault: agent write {id}`
5. A `vault:proposal_created` event is emitted on the EventBus
6. Keeper agent receives the event and files notes to permanent locations

## Human Review

Browse this folder regularly to review agent-submitted notes. After review:
- Move to permanent location (e.g., `01-projects/`, `03-resources/`)
- Update `status` from `inbox` to `active`
- Update `updated` date
- Delete the inbox copy (git history preserves it)

## Subdirectories

- `skills/` — Agent-proposed skills (routed here by `WriteGateway` when template=`skill-proposal`)

## Feature Flag

Agent writes are gated by `FF_OBSIDIAN_GATEWAY=true`. If the flag is not set, `propose()` is a no-op.

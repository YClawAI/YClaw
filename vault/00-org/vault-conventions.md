---
title: "Vault Conventions"
created: 2026-03-02
updated: 2026-03-02
author: system
tags: [org, conventions]
status: active
---

# Vault Conventions

## Frontmatter Schema

Every note in the vault **must** include the following frontmatter fields:

| Field    | Type              | Required | Description                              |
|----------|-------------------|----------|------------------------------------------|
| `title`  | string            | ✅        | Human-readable title                     |
| `created`| YYYY-MM-DD        | ✅        | Date note was first created              |
| `updated`| YYYY-MM-DD        | ✅        | Date note was last modified              |
| `author` | string            | ✅        | Agent name (e.g. `builder`) or `human`   |
| `tags`   | list of strings   | ✅        | At least one tag (see tag convention)    |
| `status` | enum              | ✅        | `active`, `draft`, `inbox`, `archived`   |

### Example

```yaml
---
title: "Decision: Adopt new CI pipeline"
created: 2026-03-02
updated: 2026-03-02
author: strategist
tags: [dept/executive, decision, infrastructure]
status: active
---
```

## Naming Rules

- Filenames: `YYYY-MM-DD-{slug}.md` (kebab-case, no spaces)
- Agent writes to `05-inbox/` only — filename is assigned by `WriteGateway`
- Human-authored notes: placed directly in their permanent folder

## Date Format

All dates: **YYYY-MM-DD** (ISO 8601). No timestamps in frontmatter — use file system mtime for time-of-day precision.

## Tag Convention

Tags follow a hierarchical dot-path scheme using `#` prefix in Obsidian:

| Prefix      | Meaning                            | Examples                                |
|-------------|------------------------------------|-----------------------------------------|
| `dept/`     | Agent department                   | `dept/executive`, `dept/development`    |
| `agent/`    | Specific agent                     | `agent/builder`, `agent/strategist`     |
| `type/`     | Note type                          | `type/decision`, `type/runbook`         |
| (plain)     | Topic tags                         | `protocol`, `security`, `pgvector`      |

Tags in YAML frontmatter are written without the `#` prefix.

## Write Permissions

| Location         | Who Can Write    | Method                          |
|------------------|------------------|---------------------------------|
| `05-inbox/`      | Agents only      | `WriteGateway.propose()`        |
| All other dirs   | Humans only      | Direct file creation            |
| `00-org/`        | Humans only      | Direct — org structure docs     |
| `templates/`     | Humans only      | Direct — template management    |

Agents **must not** write outside `05-inbox/`. `WriteGateway` enforces this.

## Note Lifecycle

1. Agent writes note → lands in `05-inbox/` with `status: inbox`
2. Human reviews note
3. Human moves to permanent location and updates `status` + `updated`
4. Old notes with `status: archived` → move to `04-archive/`

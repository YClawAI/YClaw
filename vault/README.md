# vault/

The **organizational brain** for the agent system -- a structured [Obsidian](https://obsidian.md/) vault where agents write knowledge artifacts and humans curate them into a permanent knowledge base.

---

## Directory Structure

```
vault/
├── .obsidian/              # Obsidian app settings
│   └── app.json            # Editor config (line numbers, strict line breaks)
├── 00-org/                 # Organizational documents (human-authored)
│   ├── vault-conventions.md   # Frontmatter schema, naming rules, tag convention, write permissions
│   ├── agent-roster.md        # All 12 agents by department with roles, status, event patterns
│   └── architecture.md        # System architecture overview -- event bus, runtime, codegen, vault brain
├── 01-projects/            # Project tracking
│   └── _index.md           # Map of Content for active and recent projects
├── 02-areas/               # Ongoing area-of-responsibility folders
│   ├── development/        # (.gitkeep)
│   ├── executive/          # (.gitkeep)
│   ├── finance/            # (.gitkeep)
│   ├── marketing/          # (.gitkeep)
│   ├── operations/         # (.gitkeep)
│   └── support/            # (.gitkeep)
├── 03-resources/           # Reference material
│   ├── research/           # Market research, competitor analysis, technical investigations
│   │   └── _index.md
│   ├── runbooks/           # Operational step-by-step procedures
│   │   └── _index.md
│   └── skills/             # Agent skill proposals and learned patterns
│       └── _index.md
├── 04-archive/             # Archived notes (.gitkeep)
├── 05-inbox/               # Agent write target (WriteGateway landing zone)
│   ├── _index.md           # Explains the write gateway flow
│   └── skills/             # Agent-proposed skills (.gitkeep)
├── daily/                  # Daily standup notes (.gitkeep)
└── templates/              # Note templates (human-authored)
    ├── daily-standup.md    # Standup template: Done / Doing / Blockers / Handoffs / Notes
    ├── decision.md         # Decision record: Context / Options / Rationale / Consequences
    ├── project.md          # Project template: Overview / Goals / Scope / Milestones / Risks
    ├── research.md         # Research template: Question / Findings / Sources / Implications
    └── skill-proposal.md   # Skill proposal: Description / Trigger / Solution / Example / Checklist
```

## How It Works

### Agent Writes

Agents write to the vault through `WriteGateway.propose()`, which:

1. Accepts content and metadata from the agent
2. Runs `MemoryWriteScanner` to check for prompt injection and credential leaks
3. Writes a timestamped `.md` file to `05-inbox/` (format: `YYYY-MM-DD-{id}-{slug}.md`)
4. Auto-commits the file to git
5. Emits a `vault:proposal_created` event on the EventBus

Agent writes are gated by the `FF_OBSIDIAN_GATEWAY=true` feature flag.

### Human Curation

Humans review notes in `05-inbox/` and:

- Move approved notes to their permanent location (`01-projects/`, `02-areas/`, `03-resources/`)
- Update `status` from `inbox` to `active`
- Archive old notes to `04-archive/`

### Semantic Search

`VaultSyncEngine` chunks and embeds all notes into pgvector. Agents query via `VaultReader`, which exposes file read and semantic search through `VaultExecutor`.

## Frontmatter Schema

Every note must include these YAML frontmatter fields:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Human-readable title |
| `created` | YYYY-MM-DD | Date first created |
| `updated` | YYYY-MM-DD | Date last modified |
| `author` | string | Agent name (e.g., `builder`) or `human` |
| `tags` | list | At least one tag (see convention below) |
| `status` | enum | `active`, `draft`, `inbox`, or `archived` |

## Tag Convention

Tags use a hierarchical prefix scheme:

| Prefix | Meaning | Examples |
|--------|---------|----------|
| `dept/` | Department | `dept/executive`, `dept/development` |
| `agent/` | Specific agent | `agent/builder`, `agent/strategist` |
| `type/` | Note type | `type/decision`, `type/runbook`, `type/skill` |
| (plain) | Topic | `protocol`, `security`, `pgvector` |

## Write Permissions

| Location | Who Can Write | Method |
|----------|--------------|--------|
| `05-inbox/` | Agents only | `WriteGateway.propose()` |
| All other directories | Humans only | Direct file creation |

Agents **must not** write outside `05-inbox/`. The WriteGateway enforces this boundary.

## Templates

Templates in `vault/templates/` provide consistent structure for common note types. Agents reference these via the `template` parameter when calling `WriteGateway.propose()`. Placeholders use `{{variable}}` syntax.

| Template | Use Case |
|----------|----------|
| `daily-standup.md` | Agent standup reports |
| `decision.md` | Architecture or strategy decisions (ADR-style) |
| `project.md` | Project planning and tracking |
| `research.md` | Research notes with findings and sources |
| `skill-proposal.md` | New skill proposals from agents |

## Note Lifecycle

```
Agent writes note -> 05-inbox/ (status: inbox)
  -> Human reviews
  -> Moved to permanent location (status: active)
  -> Eventually archived (status: archived) -> 04-archive/
```

## Security

- `MemoryWriteScanner` scans all agent writes for prompt injection patterns and credential leaks before persisting
- Agents cannot write outside `05-inbox/`
- No secrets, API keys, or internal URLs should appear in vault notes

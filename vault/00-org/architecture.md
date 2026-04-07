---
title: "System Architecture"
created: 2026-03-02
updated: 2026-03-02
author: system
tags: [org, architecture, system]
status: active
---

# System Architecture

## Overview

yclaw is a multi-agent autonomous system that operates your AI agent organization. It is a TypeScript monorepo (turborepo + npm) running on Node 20 LTS with ESM modules.

## Core Subsystems

### Event Bus (Redis pub/sub)

All agent-to-agent communication flows through the `EventBus` (`packages/core/src/triggers/event.ts`). Events follow the `source:type` naming pattern (e.g., `builder:pr_ready`, `github:ci_fail`).

The bus supports wildcard subscriptions: `forge:*` (all from forge), `*:asset_ready` (from any source).

### Agent Runtime

Each agent is defined by:
1. **YAML config** (`departments/<dept>/<agent>.yaml`) — tools, subscriptions, memory keys
2. **System prompt** (`prompts/<agent>.md`) — LLM personality and task instructions
3. **Shared runtime** (`packages/core/src/agent/executor.ts`) — LLM call loop with tools

### Coding Sessions

Builder and Architect use coding executors to run tasks. The `BuilderDispatcher` manages a priority queue; `CodingWorker` executes sessions via `PiCodingExecutor` (preferred) or `SpawnCliExecutor` (fallback).

### Codegen Pipeline

```
BuilderDispatcher (priority queue)
  → CodingWorker (distributed lock via Redis)
      → WorkspaceProvisioner (clone → branch → CLAUDE.md → execute → push)
        → CrossRepoCoordinator (multi-repo tasks)
```

### Reactions

`ReactionsManager` (`packages/core/src/reactions/manager.ts`) subscribes to all GitHub events and fires declarative rules. Rules include conditions, safety gates, and actions. Escalation timers are durable via Redis ZSET.

### Review Gates

Two safety layers for external content:
- `ReviewGate` — brand voice and content quality
- `OutboundSafetyGate` — blocks financial advice, hype, internal leaks

### Vault Brain (Obsidian)

The `vault/` directory is the **org brain** — a structured Obsidian vault where agents write notes, decisions, and knowledge artifacts.

- Agents write via `WriteGateway` → `vault/05-inbox/` (auto-committed)
- `VaultSyncEngine` chunks and embeds all notes into pgvector for semantic recall
- `VaultReader` exposes file read + semantic search to agents via `VaultExecutor`
- `MemoryWriteScanner` scans all writes for prompt injection and credential leaks

## Data Flow

```
External Triggers (GitHub, Slack, Cron, Webhooks)
  → EventBus (Redis pub/sub)
    → AgentExecutor (LLM call loop)
      → ActionExecutors (github, slack, event, codegen, vault, ...)
        → Review Gates (for external content)
          → External Platforms (GitHub API, Slack, Twitter, ...)
```

## Key File Paths

| Subsystem              | Path                                               |
|------------------------|----------------------------------------------------|
| Agent configs          | `departments/<dept>/<agent>.yaml`                  |
| System prompts         | `prompts/<agent>.md`                               |
| Core runtime           | `packages/core/src/`                               |
| Event bus              | `packages/core/src/triggers/event.ts`              |
| Memory scanner (WAF)   | `packages/core/src/security/memory-scanner.ts`     |
| Vault knowledge module | `packages/core/src/knowledge/`                     |
| Vault brain            | `vault/`                                           |
| Repo configs           | `repos/*.yaml`                                     |
| Agent tests            | `packages/core/tests/`                             |

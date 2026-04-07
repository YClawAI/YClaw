# YCLAW Documentation

> Complete documentation for the YCLAW agent harness.

---

## Getting Started

| Doc | Description |
|-----|-------------|
| [quickstart.md](quickstart.md) | Zero to running in 15 minutes (Docker Compose) |
| [cli.md](cli.md) | All CLI commands, flags, and exit codes |
| [configuration.md](configuration.md) | `yclaw.config.yaml` schema reference |

## System Design

| Doc | Description |
|-----|-------------|
| [architecture.md](architecture.md) | System design, interfaces, adapters, data flow |
| [operators.md](operators.md) | 4-tier RBAC, permissions, invitations |
| [security.md](security.md) | 7 security domains, threat model |
| [observability.md](observability.md) | Health, errors, audit timeline, debugging |
| [onboarding.md](onboarding.md) | Conversational setup flow, asset ingestion |

## Deployment

| Doc | Description |
|-----|-------------|
| [deployment/docker-compose.md](deployment/docker-compose.md) | Local and VPS deployment guide |
| [deployment/aws.md](deployment/aws.md) | AWS production deployment guide |

## Extending

| Doc | Description |
|-----|-------------|
| [adapters.md](adapters.md) | Building custom channel, store, and secret adapters |
| [supported-configs.md](supported-configs.md) | Full compatibility matrix |

## Internal Reference (from production system)

These docs describe the internal agent runtime extracted from the production system. They may reference features specific to the Gaze Protocol deployment.

| Doc | Description |
|-----|-------------|
| [AUTONOMOUS-PIPELINE.md](AUTONOMOUS-PIPELINE.md) | Issue-to-deploy pipeline, ReactionsManager rules |
| [COORDINATION.md](COORDINATION.md) | Inter-agent event system, Redis Streams |
| [DISPATCHER.md](DISPATCHER.md) | Builder Dispatcher-Worker architecture |
| [PROMPT-SYSTEM.md](PROMPT-SYSTEM.md) | System prompt loading and mutability rules |
| [KNOWLEDGE-VAULT.md](KNOWLEDGE-VAULT.md) | Obsidian-style knowledge vault |
| [MISSION-CONTROL.md](MISSION-CONTROL.md) | Mission Control dashboard architecture |
| [ops.md](ops.md) | Operations runbook |

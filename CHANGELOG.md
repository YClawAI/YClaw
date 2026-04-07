# Changelog

All notable changes to YCLAW are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

Initial open-source release. Phases 1-6 of the product framework.

### Added

#### Infrastructure Abstractions (Phase 1)
- `IStateStore` interface with MongoDB adapter (`MongoStateStore`)
- `IEventBus` interface with Redis adapter (`RedisEventBus`)
- `IChannel` interface with 4 adapters: Slack, Telegram, Twitter, Discord
- `ISecretProvider` interface with 2 adapters: env file, AWS Secrets Manager
- `IObjectStore` interface with 2 adapters: local filesystem, S3
- `IMemoryStore` interface for agent memory (PostgreSQL-backed)
- `InfrastructureFactory` — creates adapters from `yclaw.config.yaml`
- Zod config schema (`YclawConfigSchema`) with environment variable fallbacks

#### Installer CLI (Phase 2)
- `yclaw init` — guided setup wizard with 3 presets (local-demo, small-team, aws-production)
- `yclaw doctor` — preflight validation (10+ diagnostic checks)
- `yclaw deploy` — deployment with Docker Compose, Terraform, or manual executor
- `yclaw destroy` — infrastructure teardown with optional volume removal
- `yclaw config validate` — schema validation for `yclaw.config.yaml`
- Interactive wizard: 7 steps (preset, purpose, infrastructure, channels, LLM, networking, review)
- Non-interactive mode with `--preset` and `--non-interactive` flags
- TTY detection and graceful fallback

#### Deploy Modes (Phase 3)
- Docker Compose deployment: multi-service compose config with health checks
- AWS Terraform deployment: 7 modules (networking, compute, database, cache, storage, secrets, monitoring)
- Root operator bootstrap during deploy (via `YCLAW_SETUP_TOKEN`)

#### Onboarding (Phase 4)
- 6-stage conversational onboarding flow (org_framing, ingestion, departments, operators, validation, completed)
- 8 questions generating 7 artifact types (org_profile, priorities, brand_voice, departments, tools, knowledge_index, operators)
- Artifact lifecycle: draft, approved, rejected with LLM-powered regeneration
- Multi-source asset ingestion: file upload (base64), URL fetch, GitHub repo archive, text paste
- File quotas: 10 MB per file, 100 MB total per org
- 14 API endpoints for session management, answering, ingestion, and validation
- Mission Control onboarding page

#### Observability (Phase 5)
- Health system: liveness (`GET /health`), readiness (`GET /health/ready`), detailed authenticated (`GET /v1/observability/health`)
- 17 standardized error codes across 5 categories (infra, llm, agent, security, channel)
- Audit timeline: unified query across operator and execution audit stores with cursor-based pagination
- Observability API: 4 authenticated endpoints (health, audit, errors, summary)
- `IMetrics` interface with `NoopMetrics` default (Prometheus-ready)
- Structured logging with `LogContext` and correlation ID propagation
- `yclaw status` CLI command with exit codes (0=healthy, 1=degraded, 2=error)
- Mission Control observability page with auto-refresh

#### Launch Polish (Phase 6)
- README rewrite with ASCII architecture diagram and quick start
- 12 documentation files covering quickstart, CLI, config, architecture, deployment, operators, security, observability, onboarding, adapters, and supported configs
- 3 example org templates (startup, agency, oss-project)
- GitHub issue templates, PR template, CODEOWNERS
- CONTRIBUTING.md with dev setup and adapter guide
- Legal disclaimer and cost warnings

### Pre-existing (from production system)
- 4-tier operator RBAC (root, department_head, contributor, observer)
- Permission engine with role grants and department-based access
- Operator invitation system with secure tokens
- API key authentication (argon2id) with optional Tailscale node binding
- Operator audit logging with 90-day TTL
- Rate limiting (RPM, concurrent, daily quotas)
- 7 security domains: supply chain, Docker, CI/CD, agent safety, runtime, monitoring, event bus auth
- Agent safety guard with protected/forbidden paths and self-modification detection
- Circuit breaker with per-agent rate limits
- HMAC-SHA256 event bus authentication with schema validation and replay prevention
- Egress allowlist for agent network access
- Mission Control dashboard with 29 pages and 56 API routes
- 3D Hive visualization for agent fleet monitoring

---

[Unreleased]: https://github.com/GravitonINC/YClaw/compare/main...HEAD

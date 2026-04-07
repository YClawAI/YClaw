# memory/ -- Persistent Agent Memory (Git-Tracked)

This directory holds git-tracked persistent state for the agent system. It is mounted as a Fargate ephemeral volume at runtime so agents can read and write to it during execution.

## Purpose

The `memory/` directory serves as a filesystem-based persistence layer for agent state that must survive across deployments. Unlike the Postgres-backed `@yclaw/memory` package (which stores structured facts, triples, and episodes), this directory holds flat files that agents read directly from disk at startup.

## Runtime Behavior

### Local Development

Files in `memory/` are read directly from the repository checkout.

### ECS Fargate (Production)

Fargate ephemeral volumes mount as empty directories, shadowing any content baked into the Docker image via `COPY`. The `entrypoint.sh` script handles this:

1. **Build time:** `Dockerfile` copies `memory/` into `/app/.image-data/memory/` (read-only backup) and `/app/memory/` (working copy).
2. **Container start:** `entrypoint.sh` detects the empty ephemeral volume at `/app/memory/` and restores content from `/app/.image-data/memory/`.
3. **Ownership fix:** `chown -R node:node /app/memory` corrects Fargate volume permissions (mounted as `root:root`).
4. **Privilege drop:** `gosu node` runs the application as the `node` user.

This same pattern applies to `departments/` and `prompts/`.

### Change Detection

The CI/CD pipeline (`deploy.yml`) includes `memory/**` in the `core` change filter. Any commit that modifies files here triggers a new Docker build and ECS deployment.

## Relationship to `packages/memory/`

| Aspect | `memory/` (this directory) | `packages/memory/` (`@yclaw/memory`) |
|--------|---------------------------|--------------------------------------|
| Storage | Git-tracked flat files | PostgreSQL + pgvector |
| Content | Filesystem-based agent state | Structured facts, categories, triples, episodes |
| Access | Direct filesystem read/write | SQL queries via `MemoryManager` API |
| Durability | Git commits + Fargate volume | RDS with RLS isolation |
| Schema | None (convention) | 12 tables, 6 migrations |

## Protected Path

This directory is protected by convention. Changes are reviewed by the Architect agent and enforced by the Definition of Done (DoD) gate at merge time.

# syntax=docker/dockerfile:1

# SECURITY: Pin base images to SHA256 digests for immutable builds.
# Tags are mutable — Renovate will auto-update digests via pinDigests: true.
# To manually pin: docker manifest inspect node:20-slim | jq -r '.config.digest'

# --- Stage 1: Production dependencies only ---
# Separate stage so the runner gets a clean node_modules without devDependencies.
# Saves ~200MB vs copying the full builder node_modules.
FROM node:20-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# Copy ALL workspace manifests to satisfy lockfile workspace references.
# npm ci validates the lockfile against declared workspaces — missing manifests
# cause undocumented behavior that breaks across npm versions.
COPY packages/core/package.json packages/core/
COPY packages/memory/package.json packages/memory/
COPY packages/mission-control/package.json packages/mission-control/
COPY ao/package.json ao/
# SECURITY: --ignore-scripts prevents malicious postinstall execution.
# Packages with native bindings (argon2) are rebuilt explicitly afterward.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts \
    && npm rebuild argon2 2>/dev/null || true

# --- Stage 2: Build (needs devDependencies for tsc, turbo, etc.) ---
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.json ./
# Copy ALL workspace manifests (same rationale as prod-deps)
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/memory/package.json packages/memory/tsconfig.json packages/memory/
COPY packages/mission-control/package.json packages/mission-control/
COPY ao/package.json ao/
# SECURITY: --ignore-scripts in build stage too (devDeps can also have malicious postinstall).
# Rebuild native bindings needed for compilation and runtime.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts \
    && npm rebuild argon2 2>/dev/null || true
COPY packages/core/src packages/core/src
COPY packages/memory/src packages/memory/src
COPY packages/memory/migrations packages/memory/migrations
# Scope to core + its deps (memory). Without --filter, turbo would also try to
# build mission-control (whose package.json is present for lockfile consistency
# but whose source code is not in this context).
RUN npx turbo build --filter=@yclaw/core...

# --- Stage 3: Production runner ---
FROM node:20-slim AS runner
WORKDIR /app

# System packages: curl (health checks), gosu (privilege drop), git (codegen workspaces)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gosu git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# CLI coding tools for codegen system.
# This layer is ~500MB but cached by Docker — only rebuilds when this line changes.
# For faster cold builds, use Dockerfile.base as the base image instead.
RUN --mount=type=cache,target=/root/.npm \
    npm install -g @anthropic-ai/claude-code @openai/codex opencode-ai 2>/dev/null || true

ENV NODE_ENV=production
ENV PORT=3000

# Production-only node_modules (devDependencies excluded)
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=builder /app/package.json package.json

# Built output only (no source)
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/package.json packages/core/package.json
COPY --from=builder /app/packages/memory/dist packages/memory/dist
COPY --from=builder /app/packages/memory/package.json packages/memory/package.json
COPY --from=builder /app/packages/memory/migrations packages/memory/migrations

# Backup for Fargate ephemeral volume shadow fix.
# Ephemeral volumes mount as empty at /app/{departments,prompts,memory},
# shadowing Docker COPY'd content. This backup lives on the read-only root FS.
COPY --chown=node:node departments .image-data/departments
COPY --chown=node:node prompts .image-data/prompts
COPY --chown=node:node memory .image-data/memory

# Copy runtime configs (works for local Docker, shadowed on Fargate)
COPY --chown=node:node departments departments
COPY --chown=node:node prompts prompts
COPY --chown=node:node memory memory
COPY --chown=node:node repos repos
COPY --chown=node:node vault vault

# Bundled meta skills for codegen provisioner
COPY --chown=node:node skills skills

# Ensure logs and tmp directories exist and are writable
RUN mkdir -p logs tmp tmp/codegen && chown -R node:node logs tmp

# Entrypoint runs as root to fix ephemeral volume ownership, then drops to node via gosu
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

EXPOSE ${PORT}

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "packages/core/dist/main.js"]

# YCLAW Core — Simplified OSS Dockerfile (Docker Compose)
# Multi-stage build, non-root user, no AO/codegen bloat.
# For production ECS deployments, use the root Dockerfile instead.

# syntax=docker/dockerfile:1

# --- Stage 1: Production dependencies ---
FROM node:20-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/memory/package.json packages/memory/
COPY packages/mission-control/package.json packages/mission-control/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts \
    && npm rebuild argon2 2>/dev/null || true

# --- Stage 2: Build ---
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/memory/package.json packages/memory/tsconfig.json packages/memory/
COPY packages/mission-control/package.json packages/mission-control/
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts \
    && npm rebuild argon2 2>/dev/null || true
COPY packages/core/src packages/core/src
COPY packages/memory/src packages/memory/src
COPY packages/memory/migrations packages/memory/migrations
RUN npx turbo build --dangerously-disable-package-manager-check --filter=@yclaw/core...

# --- Stage 3: Production runner ---
FROM node:20-slim AS runner
WORKDIR /app

# System packages: curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

# Production-only node_modules
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=builder /app/package.json package.json

# Built output
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/package.json packages/core/package.json
COPY --from=builder /app/packages/memory/dist packages/memory/dist
COPY --from=builder /app/packages/memory/package.json packages/memory/package.json
COPY --from=builder /app/packages/memory/migrations packages/memory/migrations

# Runtime configs (mounted as volumes in dev, baked in for production images)
COPY --chown=node:node departments departments
COPY --chown=node:node prompts prompts
COPY --chown=node:node repos repos

# Writable directories
RUN mkdir -p data/objects logs tmp && chown -R node:node data logs tmp

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["node", "packages/core/dist/main.js"]

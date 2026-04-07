# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# ─── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/mission-control/package.json packages/mission-control/
COPY packages/core/package.json packages/core/
COPY packages/memory/package.json packages/memory/
COPY ao/package.json ao/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=packages/mission-control --include-workspace-root

# ─── Build ─────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Copy installed deps from deps stage (node_modules + package files + symlinks)
COPY --from=deps /app ./

# Overlay source code (selective — NOT `COPY . .`)
# Only files needed for building memory → core → mission-control
COPY turbo.json tsconfig.json ./
COPY packages/memory/src packages/memory/src
COPY packages/memory/tsconfig.json packages/memory/tsconfig.json
COPY packages/core/src packages/core/src
COPY packages/core/tsconfig.json packages/core/tsconfig.json
COPY packages/mission-control/ packages/mission-control/

# Workaround: ensure core's transitive deps are resolvable from packages/core/
RUN cp -r /app/node_modules/@yclaw/core/node_modules ./packages/core/node_modules 2>/dev/null || true

ENV NEXT_TELEMETRY_DISABLED=1
# Skip Next.js lockfile patcher — misparses packageManager "npm@10.0.0" as
# "yarn@npm@10.0.0" and crashes with "Failed to patch lockfile". Known Next.js
# bug in monorepo/workspace setups.
ENV NEXT_PRIVATE_SKIP_LOCKFILE_PATCH=1

# Turbo handles the build DAG (memory → core → mission-control) in parallel.
# Replaces 3 sequential `npm run build --workspace=` commands.
RUN npx turbo build --filter=@yclaw/mission-control...

# ─── Runtime ───────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001

RUN apk add --no-cache wget && \
    addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/mission-control/.next/standalone ./
COPY --from=builder /app/packages/mission-control/.next/static ./packages/mission-control/.next/static

# ws must be available at runtime (serverExternalPackages).
# Standalone output doesn't always include it in monorepo setups.
# Cannot use npm install here — standalone package.json references workspace
# deps (@yclaw/core) that don't exist on the npm registry.
COPY --from=deps /app/node_modules/ws ./node_modules/ws

# Next.js needs write access to .next/server for prerender cache updates
RUN chown -R nextjs:nodejs ./packages/mission-control/.next

USER nextjs
EXPOSE 3001

CMD ["node", "packages/mission-control/server.js"]

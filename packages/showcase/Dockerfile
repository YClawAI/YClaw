# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# ─── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/showcase/package.json packages/showcase/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=packages/showcase --include-workspace-root

# ─── Build ─────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY turbo.json ./
COPY packages/showcase/ packages/showcase/

ENV NEXT_TELEMETRY_DISABLED=1
RUN npx turbo build --dangerously-disable-package-manager-check --filter=@yclaw/showcase

# ─── Runtime ───────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/showcase/.next/standalone ./
COPY --from=builder /app/packages/showcase/.next/static ./packages/showcase/.next/static

RUN chown -R nextjs:nodejs ./packages/showcase/.next

USER nextjs
EXPOSE 3002

CMD ["node", "packages/showcase/server.js"]

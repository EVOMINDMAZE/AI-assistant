# syntax=docker/dockerfile:1.7

# Multi-stage build for Next.js standalone output.
# Used in production (Oracle ARM) — local dev still uses `npm run dev` on the host.

# ── Stage 1: install dependencies ─────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` requires a lockfile; fall back to `npm install` if absent.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ── Stage 2: build the standalone bundle ──────────────
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Stage 3: minimal runner image ─────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Public assets and the standalone bundle
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Healthcheck used by docker-compose
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
    CMD wget -q -O- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]

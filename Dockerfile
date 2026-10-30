# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# StickyNotes AI — one Dockerfile, four stages.
# Compose builds `target: dev` for development; a production build would use
# `target: runner`. Same file, same code path, no drift between test & ship.
# ─────────────────────────────────────────────────────────────────────────────

# BASE: the shared foundation every later stage inherits from.
# Pin the MAJOR version. Never `:latest` — that's a reproducibility hole.
# node:24-alpine is multi-arch (arm64 + amd64); your M1 pulls the native
# arm64 image. NO `platform:` override needed — that would force Rosetta
# emulation and roughly halve your build speed for zero benefit.
FROM node:24-alpine AS base
# libc6-compat: glibc shims for packages that assume them under Alpine's musl.
# openssl: Prisma and some crypto native modules probe for it at runtime.
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ─────────────────────────────────────────────────────────────────────────────
# DEPS: install dependencies ONCE, cached by Docker's layer graph.
# This layer only rebuilds when package.json / package-lock.json change —
# so editing a .tsx file later does NOT re-trigger a full npm ci.
# The BuildKit cache mount keeps the npm download cache across builds.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ─────────────────────────────────────────────────────────────────────────────
# DEV: what `docker compose up` actually runs.
# Code arrives via bind mount, not COPY — that's what makes hot reload work.
# We COPY . . anyway as a fallback so the image still functions standalone.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
# Next 16 binds 0.0.0.0 by default, so no -H flag is required.
CMD ["npm", "run", "dev"]

# ─────────────────────────────────────────────────────────────────────────────
# BUILDER: the production compile. `output: "standalone"` in next.config.ts
# makes Next trace the exact server files needed and emit .next/standalone/server.js
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# RUNNER: the shipped image. No source code, no devDependencies, non-root user.
# This is the security payoff of multi-stage: the attacker surface is a
# trimmed runtime, not your whole repo.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# standalone/ already contains a minimal traced node_modules — that's why the
# runner never copies the full one. public/ and static/ are NOT auto-copied,
# so we bring them in by hand (documented in the Next output docs).
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

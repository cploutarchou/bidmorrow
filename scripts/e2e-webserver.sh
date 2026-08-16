#!/usr/bin/env bash
# Phase 12 stage A: the Playwright `webServer.command` for tests/e2e — builds
# the SPA, writes a fresh local-only .dev.vars, resets local D1 state,
# applies migrations + the demo seed, then starts `wrangler dev` on :8787
# (which serves both /api/* and the built SPA — wrangler.jsonc `assets`).
# Deterministic and network-free beyond localhost: every step here is local
# build/migrate/seed, no external calls.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[e2e] building web SPA..."
pnpm --filter @bidmorrow/web build

echo "[e2e] writing apps/worker/.dev.vars..."
node scripts/e2e-write-dev-vars.mjs

cd apps/worker

echo "[e2e] resetting local D1 persist state for a deterministic seed..."
rm -rf .wrangler/state

echo "[e2e] applying migrations..."
npx wrangler d1 migrations apply bidmorrow --local

echo "[e2e] applying demo seed..."
npx wrangler d1 execute bidmorrow --local --file "$ROOT_DIR/scripts/seed-demo.sql"

echo "[e2e] starting wrangler dev on :8787..."
# SEC-P12-01: bind loopback explicitly — the gated /api/test/* hooks must
# never be reachable from LAN peers even on a developer machine.
exec npx wrangler dev --port 8787 --ip 127.0.0.1

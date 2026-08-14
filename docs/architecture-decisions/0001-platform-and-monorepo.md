# ADR-0001: Cloudflare Workers modular monolith, D1, plain pnpm workspace

Status: Accepted (2026-08-14)

## Context

Hard cost ceiling: fixed infra < $100/mo, target $5–30/mo. Small team (one
developer + Claude Code). Product needs: HTTPS API, SPA, daily scheduled
ingestion of a few hundred notices, async scoring, daily email digests,
relational storage measured in low GB.

## Decision

- Single Cloudflare Worker (modular monolith) hosting Hono API, React/Vite
  SPA via **Workers Static Assets** (`not_found_handling:
"single-page-application"`, `run_worker_first: ["/api/*"]`), queue
  consumers, and cron handlers. Workers Paid plan ($5/mo) — required
  headroom for CPU limits, D1 10 GB, Queues allowance, 30-day Time Travel.
- **D1** as the only database. Verified limits fit: 10 GB/database vs a
  projected ≤3–5 GB steady state at 100 customers (docs/cost-model.md).
- Plain **pnpm workspace**; module boundaries via packages. **No Turborepo**:
  ~14 small packages, CI runtime dominated by tests not orchestration.
- TypeScript strict; Drizzle ORM (0.45.x stable) for the app schema.

## Consequences

- One deploy unit: simple releases, shared cold-start budget; background
  work must stay bounded to protect interactive CPU (enforced via queue
  batch caps and cron/queue 15-min CPU allowance).
- D1 is SQLite: migration patterns constrained (migration-safety skill);
  single-region write locality is acceptable for a daily-batch product.
- Vendor concentration on Cloudflare accepted for cost; the domain layer is
  platform-agnostic TypeScript, and data is exportable (D1 export + R2).

## Alternatives considered

- Fly.io/Railway + Postgres: better SQL, but $15–40/mo baseline, more ops
  surface (patching, connection pooling), no free static/queue tier.
- Vercel + Neon: function pricing and Postgres cold starts; multi-vendor.
- Cloudflare Pages: maintenance-mode for new projects; official guidance is
  Workers Static Assets.
- Microservices/separate ingestion worker: no isolation need at this scale;
  more deploys, more cost, same blast radius via shared D1.

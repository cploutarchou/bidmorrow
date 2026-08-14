# BidMorrow Architecture

Modular monolith on Cloudflare Workers. One deployable Worker serves the API,
the SPA (via Static Assets), queue consumers, and cron handlers. Modules are
enforced by pnpm workspace package boundaries, not by network boundaries.

```
                      ┌──────────────────────────────────────────────┐
                      │  Cloudflare Worker (apps/worker)             │
 Browser ── HTTPS ──► │  Hono API  /api/*        (run_worker_first)  │
   ▲                  │  Static Assets: React SPA + marketing pages  │
   │                  │  Cron handlers  ── enqueue ──► Queues        │
   │                  │  Queue consumers (ingest, match, digest)     │
   └── digest email ◄─┤                                              │
        (Resend)      └───────┬──────────────┬──────────────┬────────┘
                              │              │              │
                            D1 (SQLite)     R2 (snapshots) Stripe/Resend/TED
```

## Repository structure

```
apps/
  web/          React + Vite SPA and marketing pages (static output)
  worker/       Worker entry: Hono app, cron, queue consumers, wrangler config
packages/
  auth/         Better Auth configuration + middleware (ADR-0002)
  config/       typed env/config loading, feature-flag access
  db/           Drizzle schema + repository layer (organizationId-required)
  domain/       shared domain types (Notice, Lot, Match, ...), pure logic
  ted/          ProcurementSource implementation for TED (client, parser)
  procurement/  source-agnostic ingestion orchestration, checkpoints, retention
  matching/     deterministic scoring engine (versioned), risk flags
  notifications/ digest generation + email provider interface (Resend impl)
  billing/      Stripe checkout/portal/webhooks/entitlements
  analytics/    first-party product events
  observability/ structured logging, correlation IDs, counters, health
  ui/           shared React components
migrations/     numbered SQL migrations (wrangler d1 migrations)
scripts/        dev/ops scripts (seed, fixture refresh)
tests/          fixtures/ unit/ contract/ integration/ security/ e2e
docs/           this documentation; docs/architecture-decisions/ ADRs
```

Plain pnpm workspace — no Turborepo (repo is small; revisit only if build
times demonstrably hurt). TypeScript strict everywhere.

## Module dependency rules

- `domain` depends on nothing internal. `db` depends on `domain`.
- Feature packages (`ted`, `procurement`, `matching`, `notifications`,
  `billing`, `analytics`) depend on `domain` + `db` (+ `observability`),
  never on each other except `procurement → ted` via the
  **ProcurementSource interface** defined in `domain`.
- `apps/worker` is the only composition root: wires config, bindings, routes,
  consumers. `apps/web` talks only to `/api/*` + shared types from `domain`.

## Request path (interactive)

Hono middleware chain: request-id → structured logger → secure headers/CSP →
CORS (same-origin app; marketing pages static) → Better Auth session →
organization context resolution (from session membership, never from client
input) → zod-validated route handlers → repository layer (every
organization-scoped function requires `organizationId`).

Performance targets: API p95 < 500 ms excluding upstream calls; dashboard
usable ~2 s; pagination everywhere; indexes per docs/data-model.md; no N+1
(repositories batch by design).

## Background paths

- **Ingestion** (cron daily + catch-up): cron enqueues a bounded run →
  consumer pulls one publication-date window from TED (scoped query per
  docs/ted-ingestion-scope.md), parses eForms XML, writes notice/version/lot
  rows idempotently, stores raw snapshot in R2 (ADR-0005), advances
  checkpoint only on full window success, then enqueues match computation
  per new/changed lot. Failures land in ingestion_errors; run status is
  never falsely successful. Bounded: request budget, ≤K windows/run,
  max retries with DLQ.
- **Matching**: queue consumer scores (org × lot) pairs pre-filtered by CPV
  scope intersection; writes tender_matches + components + risk flags with
  ENGINE_VERSION.
- **Digest** (cron daily per timezone batch): selects orgs due, enqueues
  digest generation; DB-unique (org, digest_date) makes sends idempotent;
  delivery tracked in email_deliveries with bounded retries.
- **Retention**: daily purge job archives notices deadline+N days past
  (default 90): normalized rows pruned, R2 snapshot retained per lifecycle.
- TED outage never affects login/dashboard — ingestion is fully async.

## Platform bindings (apps/worker wrangler.jsonc)

D1 (`DB`) · Queues producers/consumers (`INGEST_QUEUE`, `MATCH_QUEUE`,
`DIGEST_QUEUE` + DLQs) · R2 (`SNAPSHOTS`) · Static assets (`ASSETS`,
SPA fallback, `run_worker_first: ["/api/*"]`) · native rate-limit bindings
for auth + API abuse protection · cron triggers (ingestion, digest,
retention, stale-ingestion watchdog) · `nodejs_compat` flag (Better Auth).
Environments: local / test / staging / production — separate databases,
queues, buckets, secrets per environment, always.

## Security architecture (summary — full detail docs/security.md, threat model docs/threat-model.md)

Server-side authorization only; org context from session membership;
repository layer requires organizationId (grep-auditable isolation); zod
validation at every boundary; React default escaping + CSP + secure headers;
Better Auth CSRF (origin validation) + secure cookies; built-in +
binding-based rate limiting; Stripe webhook signature verification +
event-ID idempotency; secrets via wrangler secrets per env; INTERNAL_ADMIN
gated by allowlist + audited; all procurement content treated as hostile.

## Key decisions (ADR index)

| ADR | Decision |
|---|---|
| 0001 | Cloudflare Workers modular monolith; D1; pnpm workspace, no Turborepo |
| 0002 | Better Auth + official Drizzle adapter over D1; CLI-generated auth schema |
| 0003 | Scoped TED ingestion (CPV superset) + 90-day post-deadline retention |
| 0004 | Currency: EUR direct + ECB reference rates for major non-EUR; else UNKNOWN |
| 0005 | Raw eForms XML snapshots in private R2, hashed deterministic paths |
| 0006 | Queues + Cron Triggers, not Workflows |

## Deliberate non-choices

No microservices, no Durable Objects (native rate-limit binding suffices),
no Workflows (per-step billing; two simple pipelines), no LLM in production
path, no paid analytics/monitoring/translation, no Turborepo, no server-side
rendering framework (SPA + static marketing pages meet SEO needs; revisit
only with evidence).

# Dependency & Platform Version Register

Verified against official sources on **2026-08-14** (npm registry for
versions; official docs for behavior). Re-verify via the verify-current-docs
skill before relying on any entry older than ~1 month.

## Pinned application dependencies (Phase 2 targets)

| Package | Version | Notes |
|---|---|---|
| typescript | 5.9.x pin | npm latest is 7.0.2 (native-compiler era); we pin the mature 5.x line until the Vite/Vitest plugin ecosystem is verified on TS7 (revisit Phase 12) |
| pnpm | 11.x | workspace manager |
| hono | 4.13.x | built-in secure-headers/csrf/cors middleware; validation via @hono/zod-validator 0.9.x |
| react / react-dom | 19.2.x | |
| vite | 8.2.x | Vite 8 is current stable |
| vitest | 4.1.x | Vitest 5 is RC — do not adopt |
| @cloudflare/vitest-pool-workers | 0.21.x | peer vitest ^4.1.0; Vite-plugin architecture (`cloudflareTest()`); D1 migrations in tests via readD1Migrations/applyD1Migrations; per-file storage isolation |
| @playwright/test | 1.62.x | |
| wrangler | 4.x (4.123.0) | wrangler.jsonc recommended config format; `migrations_pattern` supports Drizzle nested layout |
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 | 1.0 at rc.4 — pin 0.45.x, revisit after 1.0 stable |
| better-auth | 1.6.29 | 1.7 at rc — pin stable; no beta/RC auth (project rule) |
| @better-auth/drizzle-adapter | 1.6.x | official adapter package (moved out of better-auth core path); peer drizzle-orm ^0.45.2 |
| stripe | 22.x | pinned API version 2026-07-29.dahlia; Workers requires `constructEventAsync` (SubtleCrypto) |
| resend | 6.x | fetch-based; Workers-compatible; batch ≤100/call; default rate limit 2 req/s |
| zod | 4.x (verify at install) | validation at API boundary |

## Platform facts (Cloudflare, verified 2026-08-14)

- Workers Paid $5/mo: 10M req + 30M CPU-ms/mo; static asset requests free/unlimited.
- **D1**: max **10 GB/database (paid)**; $5 plan includes 25B row reads, 50M row
  writes, 5 GB storage/mo; 1,000 queries per invocation; 100 KB max statement.
- **D1 Time Travel**: 30-day retention (paid), free, always-on.
  Bookmark: `wrangler d1 time-travel info <DB>`; restore:
  `wrangler d1 time-travel restore <DB> --bookmark=<B>`.
- **Queues**: at-least-once delivery (consumers must be idempotent); paid plan
  1M ops/mo included then $0.40/M; msg ≤128 KB; batch ≤100; DLQ support;
  free tier exists (10k ops/day) but we run on paid anyway.
- **Cron Triggers**: 250/account (paid). Cron/queue invocations get up to
  15 min CPU.
- **Workers Static Assets** is the recommended SPA hosting (Pages is
  maintenance-mode for new projects): `assets.not_found_handling:
  "single-page-application"`, `run_worker_first: ["/api/*"]`.
- **Native rate-limiting binding**: GA since 2025-09; `[[ratelimits]]` with
  `simple = { limit, period: 10|60 }`; per-colo best-effort; no extra cost.
- **Workflows**: GA but bills per-step since ~2026-08 — not used (ADR-0006).
- **R2**: free tier 10 GB + 1M Class A + 10M Class B per month; lifecycle
  rules supported (age-based deletion / IA transition).

## Stripe facts

- Current API version: `2026-07-29.dahlia`; monthly dated versions,
  biannual named majors.
- Subscription webhook set (verify wording again in Phase 9):
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.paid`, `invoice.payment_failed`.
- Ordering NOT guaranteed; at-least-once delivery → dedupe on event ID +
  re-fetch object state from the API instead of trusting payload order.

## Better Auth facts

- Cookie sessions, DB session table, 7-day expiry / 1-day updateAge defaults.
- CSRF: origin-header validation against `trustedOrigins` (token-less) +
  Fetch Metadata; never disable.
- Email verification + password reset built in, with anti-enumeration
  (uniform responses).
- Organization plugin is first-party in core — used for org modeling.
- Rate limiting built-in; storage must be `"database"` or secondary storage
  on Workers (in-memory default is unusable there).
- Workers requires `nodejs_compat` compatibility flag (AsyncLocalStorage).
- With the Drizzle adapter, auth schema is CLI-generated
  (`npx @better-auth/cli generate`) then migrated via drizzle-kit/wrangler —
  programmatic `getMigrations` does NOT work with the Drizzle adapter.

## TED / eForms / CPV / NUTS

See docs/ted-data-source.md (research recorded separately).

## Known imminent majors (watchlist)

Drizzle 1.0 (rc.4) · Better Auth 1.7 (rc.6) · Vitest 5 (rc.1) · TS 7 native.
None adopted pre-stable; revisit at Phase 12.

## Unverified / to re-check when network allows

- Resend pricing tiers (free 3k/mo, $20/50k figures from secondary sources).
- Stripe webhook-set page wording (verified via snippets + stripe-node source).

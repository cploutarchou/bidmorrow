# Deployment

Definitive deployment procedure for BidMorrow. **Status: Phase 13 —
staging AND production LIVE (2026-08-16)**. Staging serves at
`https://staging.bidmorrow.com` (custom domain since 2026-08-16;
previously workers.dev): `.github/workflows/deploy-staging.yml`
auto-deploys every merge to `main` (queues/R2 ensured idempotently in
the workflow), migrations applied to the remote D1 (WEUR), secrets
pushed, CI smoke tests green, ingestion unpaused after the
pre-first-ingestion gates passed. Production serves at
`https://bidmorrow.com` (see "Custom domain & DNS"). Remaining
prerequisites live in HUMAN_DECISION_BLOCKERS.md.

## Environments

| Env        | Purpose                           | D1 / Queues / R2              | Paddle environment     | Secrets                                |
| ---------- | --------------------------------- | ----------------------------- | ---------------------- | -------------------------------------- |
| local      | dev on `wrangler dev` (Miniflare) | local simulators              | sandbox keys (or none) | `.dev.vars` (git-ignored)              |
| test       | CI (vitest-pool-workers)          | ephemeral, per-file isolation | mocked                 | injected by test config                |
| staging    | pre-prod verification             | dedicated staging resources   | **sandbox**            | `wrangler secret put --env staging`    |
| production | customers                         | dedicated prod resources      | **production (live)**  | `wrangler secret put --env production` |

Rules: environments **never** share databases, queues, buckets, secrets, or
Paddle environments. Staging always uses Paddle **sandbox** credentials
(`pdl_sdbx_…` key, `test_…` client token, `PADDLE_ENVIRONMENT=sandbox`);
production always live (`pdl_live_…`, `live_…`,
`PADDLE_ENVIRONMENT=production`) — never mixed (blocker 4, ADR-0011).

## wrangler.jsonc structure (apps/worker) [validate: Phase 13]

```jsonc
{
  "name": "bidmorrow",
  "main": "src/index.ts",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"],
  },
  "d1_databases": [{ "binding": "DB", "database_name": "bidmorrow-dev", "database_id": "…" }],
  "queues": {
    "producers": ["INGEST_QUEUE", "MATCH_QUEUE", "DIGEST_QUEUE"],
    "consumers": ["… + DLQs, max_retries, dead_letter_queue"],
  },
  "r2_buckets": [{ "binding": "SNAPSHOTS", "bucket_name": "bidmorrow-snapshots-dev" }],
  "triggers": { "crons": ["ingestion", "digest", "retention", "watchdog schedules"] },
  "env": {
    "staging": {/* staging DB id, queue names, bucket, vars */},
    "production": {/* production DB id, queue names, bucket, vars */},
  },
}
```

Top-level config = local dev. Each env block redeclares **all** bindings with
env-specific resource names/ids — wrangler does not inherit bindings.

## Secrets management

- Set per environment: `wrangler secret put BETTER_AUTH_SECRET --env production`
  (repeat for `RESEND_API_KEY`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
  `PADDLE_PRICE_FOUNDING_MONTHLY`, `PADDLE_PRICE_STANDARD_MONTHLY`,
  `ADMIN_EMAILS`; `PADDLE_CLIENT_TOKEN` and `PADDLE_ENVIRONMENT` are
  GitHub environment _variables_ pushed the same way). Same command with
  `--env staging`.
- CI holds only `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (blocker 1),
  stored as **GitHub environment secrets** on `staging` and `production`
  GitHub environments — production environment requires reviewers (blocker 8).
- Values are human-provided; Claude never invents them. Local dev uses
  `.dev.vars` (git-ignored, deny-listed).

## CI/CD flow [validate: Phase 13]

1. **PR pipeline** (every PR): install (frozen lockfile) → format/lint →
   typecheck → unit/contract/integration/security tests → build → gitleaks.
   All gates required to merge (blocker 8 branch protection).
2. **Staging auto-deploy**: merge to the integration branch triggers
   `wrangler d1 migrations apply bidmorrow-staging --env staging --remote`
   then `wrangler deploy --env staging`, then automated smoke tests
   (health endpoint, login, one API round-trip).
3. **Production deploy**: `.github/workflows/deploy-production.yml` —
   dispatch-only, gated three ways (GitHub Required reviewers need
   Enterprise on private repos, so they are NOT used): the `production`
   environment is restricted to protected branches only, the dispatch
   requires typing `confirm: deploy-production` (validated as the job's
   first step), and by convention Claude never dispatches a production
   deploy without explicit owner instruction. Steps: ensure
   queues/R2/D1 idempotently
   (first run creates them; the resolved D1 id is patched into the
   checkout and printed as `PRODUCTION_D1_ID` for committing) → capture
   D1 Time Travel bookmark → apply migrations → verify FK enforcement
   live (`PRAGMA foreign_keys` must return 1 — P10-R-04; the staging
   deploy runs the same check) → seed
   `ingestion_paused=true` (unpausing is a deliberate go-live step) →
   build SPA → `wrangler deploy --env production` (attaches
   bidmorrow.com on first run) → push runtime secrets → post-deploy
   smoke against `https://bidmorrow.com` (with a provisioning retry for
   the first-run domain/cert).

### Pre-first-ingestion gates (from Phase 5 audits — MUST close on staging before the production ingestion cron is enabled)

The TED API is unreachable from the development environment, so two
verifications could only be deferred to the first staging deploy:

1. **TED-P5-01**: round-trip the composed scope query through the live API
   with `checkQuerySyntax: true` (see `packages/procurement/src/scope.ts`
   `buildScopeQuery`); fix syntax if rejected before any real window runs.
2. **Volume measurement**: run one bounded staging ingestion window and
   record actual scoped notices/day in docs/cost-model.md + the ledger
   (planning assumption is 150–300/day; tighten scope before widening if
   reality exceeds 2× projection per ADR-0003).
3. Refresh fixtures from live published notices (ted-fixture-refresh skill)
   to complement the OP-TED SDK example fixtures (TED-P5-02 audit note).
   Plan: source them from the first staging ingestion's R2 snapshots
   (real notices our own pipeline stored) rather than separate API pulls.

Status 2026-08-16: gates 1–2 CLOSED (ted-gates workflow run #3 — two
grammar fixes landed, volume measured ≈143/day weekday avg); gate 3
pending the first staging ingestion window.

## Migration deployment procedure

Migrations are numbered SQL under `migrations/`, applied with wrangler.

1. Apply and verify on **staging first**:
   `wrangler d1 migrations apply bidmorrow-staging --env staging --remote`
2. Before any risky production migration (DDL on populated tables,
   data-rewriting statements), capture a restore point:
   `wrangler d1 time-travel info bidmorrow-prod --env production`
   and record the bookmark in the deploy log.
3. Apply to production:
   `wrangler d1 migrations apply bidmorrow-prod --env production --remote`
4. If it goes wrong: docs/backup-restore.md, "bad migration" playbook.

Migrations are **roll-forward by default** — write a new corrective
migration rather than editing an applied one; Time Travel restore is the
emergency path only.

## Custom domain & DNS

- The `bidmorrow.com` zone is on Cloudflare (Full setup, active —
  confirmed 2026-08-16).
- **Production**: `wrangler.jsonc` `env.production` declares
  `routes: [{ pattern: "bidmorrow.com", custom_domain: true }]` and
  `workers_dev: false`. The **first** `wrangler deploy --env production`
  attaches the domain — wrangler creates the DNS record and certificate
  itself; there are no dashboard steps. Until that deploy, the zone
  Overview showing **"No Workers connected" is expected**, not an error.
  Never use the dashboard's "Connect Worker" button to attach the staging
  worker to the zone — that would serve the staging environment (Paddle
  sandbox, staging DB) on the production domain.
- `www.bidmorrow.com` → apex: one Cloudflare **Redirect Rule**
  (Dashboard → Rules → Redirect Rules), owner action at production
  cutover. Recorded on the production cutover checklist.
- **Staging** serves on `staging.bidmorrow.com` (custom domain, decided
  by the owner 2026-08-16; workers.dev disabled). Attached automatically
  the same way as the apex — wrangler creates the `staging` DNS record +
  certificate at deploy; error 100117 means a conflicting pre-existing
  `staging` record must be deleted from the zone first. The old
  workers.dev origin stops serving once `workers_dev: false` deploys —
  update the sandbox notification destination URL accordingly
  (see "Paddle webhook registration").
- HSTS and CSP come from the Worker (security.md C3/C4), not DNS.

## Paddle webhook registration (ADR-0011)

Paddle calls these "notification destinations" (dashboard: Developer
tools → Notifications). Each destination has its OWN secret
(`pdl_ntfset_…`) — sandbox and live are separate accounts with separate
destinations and secrets, never shared.

- **Sandbox → staging (DONE 2026-08-25, created via the Paddle MCP):**
  destination `ntfset_01m0wx39g6qmk4m1bmf39mpa4d` →
  `https://staging.bidmorrow.com/api/webhooks/paddle`, `traffic_source:
all` (so simulator runs reach staging too). The owner copies its secret
  into the GitHub `staging` environment secret `PADDLE_WEBHOOK_SECRET`
  (blocker 4); the deploy workflow pushes it to the Worker.
- **Live → production (owner, before the first real charge):** in the
  LIVE dashboard create a destination for
  `https://bidmorrow.com/api/webhooks/paddle` with the same event set and
  copy its secret into the `production` environment secret.

Subscribed events (the implemented handler, `packages/billing/src/webhook.ts`):
`subscription.created`, `subscription.activated`, `subscription.trialing`,
`subscription.updated`, `subscription.past_due`, `subscription.paused`,
`subscription.resumed`, `subscription.canceled`. Every event is processed the
same way (re-fetch the subscription, upsert) so adding an event never needs
code. Signature: `Paddle-Signature: ts=…;h1=…`, HMAC-SHA256 over
`${ts}:${rawBody}`; verified before parsing (docs/security.md C9).

Editing a destination's URL keeps its secret; deleting and recreating one
rotates it (then update the GitHub secret + redeploy).

## Resend domain authentication (blocker 2/3)

No customer email is sent before SPF, DKIM, and DMARC records from
Resend → Domains → bidmorrow.com are published and verified. Exact record
values are account-specific — copy from the Resend console; DMARC starts at
`p=none` with rua reporting, tightened later. This is a hard gate for
Phase 8 going live.

## Rollback strategy

- **Code**: Workers keeps prior versions — roll back via
  `wrangler rollback` (or Dashboard → Deployments → rollback to a previous
  version). Fast, no build needed. First choice for bad deploys.
- **Database**: migrations do not auto-revert. Preferred fix is a
  roll-forward corrective migration; emergency path is D1 Time Travel
  restore to the pre-migration bookmark (docs/backup-restore.md) — accepts
  loss of writes made after the bookmark.
- **Combined** (bad deploy + bad migration): roll back the Worker version
  first to stop damage, then decide forward-fix vs restore.
- **CI lever**: `.github/workflows/staging-ops.yml` (workflow_dispatch,
  staging environment creds) runs these without local Cloudflare access:
  `deployments-list`, `rollback-previous` (rollback + live health check;
  roll forward afterwards by dispatching Deploy staging),
  `d1-time-travel-info` (capture bookmark), `d1-time-travel-restore`
  (point-in-time restore + prints the `ingestion_paused` row as a
  verification marker).
- Rollback drill on staging is part of Phase 13 sign-off — **executed
  2026-08-16**: worker rollback to the previous version with live health
  green, roll-forward redeploy, and a D1 Time Travel restore to a
  pre-change timestamp verified via the `ingestion_paused` marker (see
  IMPLEMENTATION_LEDGER.md Phase 13 for run ids and bookmarks).

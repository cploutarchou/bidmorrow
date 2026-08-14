# Deployment

Definitive deployment procedure for BidMorrow. **Status: Phase 0/1 — no
environment exists yet.** Every procedure here is the plan of record, to be
executed and validated in the named phase (deployment itself is Phase 13).
Blocked prerequisites live in HUMAN_DECISION_BLOCKERS.md (items 1, 2, 3, 4,
5, 8).

## Environments

| Env        | Purpose                           | D1 / Queues / R2              | Stripe mode          | Secrets                                |
| ---------- | --------------------------------- | ----------------------------- | -------------------- | -------------------------------------- |
| local      | dev on `wrangler dev` (Miniflare) | local simulators              | test keys (or mocks) | `.dev.vars` (git-ignored)              |
| test       | CI (vitest-pool-workers)          | ephemeral, per-file isolation | mocked               | injected by test config                |
| staging    | pre-prod verification             | dedicated staging resources   | **test mode**        | `wrangler secret put --env staging`    |
| production | customers                         | dedicated prod resources      | **live mode**        | `wrangler secret put --env production` |

Rules: environments **never** share databases, queues, buckets, secrets, or
Stripe modes. Staging always uses Stripe test keys; production always live —
never mixed (blocker 4).

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
  (repeat for `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  price IDs, `ADMIN_EMAILS`). Same command with `--env staging`.
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
3. **Production deploy**: manually triggered protected workflow (GitHub
   `production` environment, required reviewers). Steps: verify staging
   smoke green → capture D1 Time Travel bookmark (see below) → apply
   migrations → `wrangler deploy --env production` → post-deploy smoke.

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

## Custom domain & DNS (blocker 2)

- DNS on Cloudflare; `bidmorrow.com` + `app.bidmorrow.com` attached as
  Workers **custom domains** (Dashboard → Worker → Settings → Domains &
  Routes). Staging on a separate hostname (e.g. `staging.bidmorrow.com`).
- HSTS and CSP come from the Worker (security.md C3/C4), not DNS.

## Stripe webhook registration [validate: Phase 13]

After first production deploy, register in the Stripe Dashboard (live mode):
endpoint `https://app.bidmorrow.com/api/billing/webhook`, events per
docs/dependency-versions.md Stripe set; copy the signing secret into
`wrangler secret put STRIPE_WEBHOOK_SECRET --env production`. Repeat in test
mode against the staging URL with the staging secret. (Blocker 4.)

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
- Rollback drill on staging is part of Phase 13 sign-off
  [validate: Phase 13].

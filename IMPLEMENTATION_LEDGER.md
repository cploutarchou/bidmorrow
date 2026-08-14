# IMPLEMENTATION LEDGER

Source of truth for cross-session state. Update before every session end /
context compaction. Read first in every session.

## Current phase

**Phase 5 — TED Ingestion: implementation + audits complete; reviewer
re-verification in progress.** Next: Phase 6 — Matching.

## Completed

### Phase 0 — Research (2026-08-14)

- Repository inspected: was empty (single README).
- Official docs verified via research subagents (full details in
  docs/dependency-versions.md and docs/ted-data-source.md):
  - TED Search API v3: `POST https://api.ted.europa.eu/v3/notices/search`,
    anonymous, expert query language, ITERATION pagination, no documented
    rate limit (self-imposed throttling required).
  - eForms: SDK 1.15.1 latest; active CVS range ~1.12–1.14; version detected
    from `cbc:CustomizationID`; competition vs result form types; field
    ID/XPath map recorded.
  - CPV 2008 current; NUTS 2024 current.
  - TED reuse: free incl. commercial, source acknowledgement required
    (Decision 2011/833/EU).
  - Cloudflare: D1 10 GB/db (paid), $5/mo plan allowances, Time Travel 30d,
    Queues at-least-once, Static Assets = recommended SPA path, native
    rate-limit binding GA, Workflows bills per-step (not used).
  - Stack: Better Auth 1.6.29 (+ official Drizzle adapter, org plugin),
    Hono 4.13, Drizzle 0.45.2, Stripe SDK 22 (constructEventAsync on
    Workers), Resend 6, Vite 8, Vitest 4.1 + pool-workers 0.21, wrangler 4.
  - Claude Code: agents support model/effort/skills/tools frontmatter
    (model: fable valid); skills = SKILL.md dirs; hooks/permissions schema
    confirmed.
- Created: `.claude/agents/` (13 agents per routing table),
  `.claude/skills/` (9 skills), `.claude/settings.json` (env-file deny
  rules, destructive-wrangler deny rules, PostToolUse typecheck hook +
  `.claude/hooks/typecheck-changed.sh`).

### Phase 1 — Product/Architecture (2026-08-14)

- docs/product-scope.md (V1 in/out, exclusions table, pricing).
- docs/architecture.md + ADRs 0001–0006 (platform/monorepo; Better Auth
  Drizzle-over-D1 route; ingestion scope + retention; currency via ECB
  reference rates; R2 snapshots; Queues+Cron over Workflows).
- docs/matching-engine.md (full deterministic spec: weights, CPV gradient,
  UNKNOWN=50% neutral policy, hard exclusions, risk flags, versioning).
- docs/ted-data-source.md, docs/ted-ingestion-scope.md (scope = 72* + 48* +
  79417000 default; retention deadline+90d; volume assumption 150–300/day
  to be MEASURED in Phase 5).
- docs/data-model.md (all required tables, constraints, indexes, growth
  profile) — drafted via subagent, to be reconciled with Better Auth
  generated schema in Phase 3/4.
- docs/threat-model.md (STRIDE-per-asset, all 21 contractual threats,
  controls C1–C11) — security-agent-owned going forward.
- docs/security.md (control baseline C1–C11, forbidden patterns).
- docs/cost-model.md ($6/mo @0–10 customers, ~$26 @100, ~$30–105 @1,000;
  D1 12-month projection ≤3–5 GB vs 10 GB limit).
- docs/dependency-versions.md (version register + platform facts + flags).
- docs/privacy.md, deployment.md, backup-restore.md, runbook.md,
  incident-response.md, customer-support.md, production-checklist.md
  (operational set; procedures marked [validate: Phase N] where they
  depend on unbuilt systems).
- CLAUDE.md, HUMAN_DECISION_BLOCKERS.md, README.md, .env.example.

### Phase 2 — Foundation (2026-08-14)

- pnpm workspace (pnpm 10.33.0, Node 22): root scripts format/lint/typecheck/
  test/build/db:migrate:local; strict tsconfig base (TS ~5.9.2, Bundler
  resolution, noEmit, source-level package exports — no per-package builds);
  ESLint flat config (no-any, no-empty-catch, no-console except warn/error);
  Prettier 3.6.
- 12 package skeletons. Real foundational code: `domain` (branded IDs,
  core unions, Unknown<T> helper, ProcurementSource interface), `config`
  (zod 4.4.3 env schema — errors list NAMES only, secrets required in
  staging/production), `observability` (JSON logger, recursive key-based
  redaction, never-throws — hardened per SEC-P2-01, child loggers for
  correlation IDs), `matching` (ENGINE_VERSION, COMPONENT_MAX sums 100,
  UNKNOWN_NEUTRAL, classify() with tested 80/65/45 boundaries), `db`
  (TenantScoped contract marker). Others are honest type-stub skeletons.
- apps/worker: Hono 4.13, secure headers + strict CSP, server-generated
  request-id, /api/health/live + /api/health/ready (no detail leakage),
  onError/notFound JSON; wrangler.jsonc (nodejs_compat, Static Assets SPA
  with run_worker_first /api/*, per-env D1 with distinct names + placeholder
  IDs → blockers item 1). migrations/0001_init.sql bootstrap applies from
  empty DB. Pool-workers 0.21 tests (7) run in real workerd with local D1;
  note: cloudflareTest()/readD1Migrations import from package ROOT in 0.21
  (docs prose partly stale), tests use `import { env, exports } from
'cloudflare:workers'`.
- apps/web: React 19.2 + Vite 8.2 shell (headline/subheadline/CTA from
  product-scope, TED attribution + decision-support disclaimer in footer,
  semantic HTML); copy exported from src/copy.ts and tested.
- CI: .github/workflows/ci.yml — frozen install, format:check, lint,
  typecheck, test, build + separate gitleaks job (fetch-depth 0). No deploy
  steps. Playwright scaffold only (config + README; suites in Phase 12).
- Deferred deliberately (P2-002/P2-003): Queues/R2/cron bindings arrive with
  their owning phases per ADR-0006; tests/{fixtures,unit,...} dirs and
  scripts/ created when their first artifacts land (unit tests are colocated
  in src/).
- PostToolUse typecheck hook verified live (P2-005): fired on every scaffold
  edit (pre-install failures surfaced TS2307 exactly as designed; silent
  green after install, including the SEC-P2-01 fix edits).
- Known INFO gap (P2-004): readiness-failure path has no automated test yet
  (code-review-verified only); add a broken-DB-binding test in a later phase.

### Phase 3 — Database (2026-08-14)

- Drizzle schema: 38 non-auth tables across 8 area files
  (identity/company/tender/ingestion/matching/engagement/billing/ops), all
  docs/data-model.md constraints encoded in-schema: named CHECK enums
  (ck__), uniques (uq__), indexes (idx_*), partial indexes, lazy circular
  FK (tender_notices.current_version_id ↔ versions). Doc reconciliations:
  exchange_rates added per ADR-0004; Better Auth note gained the Phase 3
  users-placeholder line (auth_accounts/auth_sessions deferred to Phase 4
  generation).
- migrations/0002_core_schema.sql generated by drizzle-kit 0.31 (flattened,
  headered; starts by dropping the 0001 _bootstrap placeholder). 0001
  byte-identical. drizzle-kit generate now produces a ZERO diff (schema ↔
  SQL agreement proven); packages/db/drizzle/ snapshot journal kept in-repo
  for future 0003+ diffs. Chain applies to a completely empty D1 (99
  commands, verified twice independently).
- Repository layer (11 modules): organizationId-FIRST contract on every
  tenant function; UPDATE/DELETE double-scoped (id AND organization_id);
  typed errors (CapExceededError, DuplicateDigestError,
  TenantMismatchError); caps enforced (keywords 50, CPV 30); checkpoint
  advance-only; notice versioning never overwrites history; match insert
  idempotent via (org,lot,engine_version) with verified-race handling;
  billing upsert guards stripe-customer cross-tenant hijack. An executable
  structural contract test (tests/security/tenant-isolation-contract.test.ts)
  enforces the signature rule by parsing repo sources.
- Seed: scripts/seed-demo.sql — Acme Cyber Consulting + 2 fake TED-DEMO
  notices, demo_-prefixed ids, .example hosts, manual-local-only, loudly
  marked; applies cleanly after 0001+0002.
- Tests: 111 total green — root 17 files/66 (+5 structural security),
  worker 7, packages/db 8 files/38 in real workerd D1 (migrations-from-
  empty sentinel, corpus idempotency/correction flow, run lifecycle,
  checkpoint no-backwards, cap errors, DB-enforced digest dedupe, stripe
  event idempotency, stale-rate rejection, full tenant-isolation negative
  suite incl. SEC-P3-01 regression + FK sentinel SEC-P3-02).
- Root `pnpm test` chains root+worker+db suites (P3-R-003 foot-gun noted:
  future pool-workers suites must be appended to the chain).

### Phase 4 stage A — Auth core (2026-08-14)

- Verified against live Better Auth 1.6.29 docs (github.com/better-auth/
  better-auth main branch, fetched — better-auth.com is proxy-blocked) AND
  the installed package source (`@better-auth/core`, `@better-auth/
drizzle-adapter`, `better-auth` dist), not memory: `drizzleAdapter` import
  is `@better-auth/drizzle-adapter` (separate package, matches ADR-0002 +
  dependency-versions.md pin — NOT the `better-auth/adapters/drizzle`
  subpath some doc pages show for a different release line); model
  resolution (`getModelName`) proven from `@better-auth/core` source to key
  the `schema` object passed to `drizzleAdapter` by the **mapped**
  `modelName`, so `packages/auth` sets `user.modelName`/`session.modelName`/
  `account.modelName`/`verification.modelName` to our real snake_case table
  names and keys the `schema` object with those same strings; email/reset
  hook signatures, `requireEmailVerification` (proven via sign-in/sign-up
  route source: 403 `EMAIL_NOT_VERIFIED`, sign-up returns `{token:null,
user}` while still firing `sendVerificationEmail`), `rateLimit: {enabled,
storage:'database', modelName}`, and CSRF origin-header enforcement (a
  cookie-bearing state-changing request needs a matching `Origin` header —
  discovered via a failing smoke test, not assumed) were all confirmed this
  way, not assumed from ADR prose.
- ADR-0007 followed: NO organization plugin; `packages/auth` is
  authentication-only (`createAuth` in packages/auth/src/index.ts).
- Schema reconciliation (packages/db/src/schema/identity.ts): `users`
  gained `image`; four new Better-Auth-core tables (`auth_accounts`,
  `auth_sessions`, `auth_verifications`, `auth_rate_limits`) hand-mapped
  (CLI generation can't know our table-name mapping, so it isn't
  authoritative here — documented in-file). DEVIATION recorded in-file and
  in docs/data-model.md §1: these five tables use Drizzle
  `integer(...,{mode:'timestamp_ms'})`/`{mode:'boolean'}` column modes
  (Better Auth writes native `Date`/`boolean` for those fields) — on-disk
  storage is still plain INTEGER; every other table keeps the repo's plain-
  number convention untouched. Existing Phase-3 test helpers
  (`test/helpers.ts`, `tenant-isolation.d1.test.ts`) updated to the new JS
  types (`Date`, `boolean`) for their placeholder `users` inserts.
- Migration 0003_auth_tables.sql: additive only (4x CREATE TABLE + indexes,
  1x ALTER TABLE users ADD COLUMN image). Procedure: rebuilt
  packages/db/drizzle/ as a two-step baseline→diff (old schema snapshot,
  then new schema diff) since the in-repo drizzle/ journal only tracks a
  single collapsed snapshot (mirroring the Phase 3 0000_core_schema.sql
  pattern) — flattened the diff into the migration, then regenerated a
  fresh single `packages/db/drizzle/0000_core_schema.sql` baseline and
  proved `drizzle-kit generate` afterward gives **zero diff**. Full chain
  (0001+0002+0003) verified twice: once against a brand-new scratch D1
  (`--persist-to` under the session scratchpad; 0001✅/0002✅/0003✅, 11
  commands on 0003) and once via `pnpm db:migrate:local`. 0001/0002
  untouched (only 0003 is new).
- packages/notifications: added `EmailProvider`/`EmailMessage` +
  `createLoggingEmailProvider(logger)` — logs `kind`+`to` only, never
  `subject`/`text` (which may carry a verification/reset URL) — Resend
  implementation still Phase 8 (blocker 3).
- apps/worker: `/api/auth/*` mounted per the documented Hono pattern
  (`app.on(['GET','POST'], ...)`); `Env` gained `APP_ENV`/`APP_BASE_URL`/
  `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`; wrangler.jsonc got non-secret
  `vars` per env + comments pointing secrets at `wrangler secret put`/
  `.dev.vars`; `.dev.vars.example` added (gitignore needed a
  `!.dev.vars.example` exception — `.dev.vars.*` was blanket-ignoring it).
- Smoke tests (apps/worker/src/auth.test.ts, real workerd+D1, pool-workers):
  10 tests — sign-up creates `users` row with `email_verified=0` and fires
  the logging email stub with `kind=verification`+the email (asserted via a
  `console.warn`/`console.error` capture, with a regression assertion that
  NO captured log line contains the verification URL/token); unverified
  sign-in → 403 `EMAIL_NOT_VERIFIED`, no session cookie; after setting
  `email_verified=1` directly in D1, sign-in succeeds, sets an HttpOnly
  session cookie, `get-session` returns the user, `sign-out` clears the
  session (subsequent `get-session` → null). Existing
  packages/db/src/migrations.d1.test.ts sentinel updated for the 4 new
  tables + 0003 in `d1_migrations`.
- Gates (all executed 2026-08-14, real output, no claims without runs):
  `pnpm format:check` PASS · `pnpm lint` PASS · `pnpm typecheck` PASS
  (14/14 workspace projects) · `pnpm test` PASS — root 17 files/66 tests,
  worker 2 files/10 tests (workerd+D1), db 8 files/38 tests (workerd+D1) =
  114 tests total, zero skipped/deleted · `pnpm build` PASS (vite + wrangler
  deploy --dry-run, bindings listed including the new `vars`).

### Phase 4 stage B — Tenancy (2026-08-14)

- Verified against installed `better-auth@1.6.29` source (not memory):
  `auth.api.getSession({ headers })` returns `{ session, user } | null`
  (`requireHeaders: true`, `dist/api/routes/session.mjs`);
  `auth.api.deleteUser({ headers, body })` is disabled by default and
  throws 404 unless `user.deleteUser.enabled` is set
  (`dist/api/routes/update-user.mjs`) — enabled in `packages/auth`
  (password/verification-email confirmation left off for V1; the
  composition root's own domain-level gate — sole-OWNER orgs cannot
  self-delete — is the safety check instead); `internalAdapter.deleteUser`
  cascades `auth_accounts`/`auth_sessions` but NOT `organization_members`
  (no FK cascade — that table is domain-owned), so the account-deletion
  handler removes membership rows itself first. Better Auth's own
  database-storage rate limiter applies a strict 3-req/10s rule to
  sign-up/sign-in keyed by `x-forwarded-for` (`@better-auth/core/dist/
utils/ip.mjs`) — the new SEC-P3-04 test suite gives each test-created user
  a distinct synthetic IP so its own volume doesn't self-throttle; also
  caught (and fixed) that Better Auth lowercases emails on sign-up, so the
  test helper's raw-SQL force-verify update needed lowercase addresses to
  match.
- apps/worker/src/env.ts: `Env`/`Variables`/`AppBindings` extracted from
  index.ts (avoids a circular import with the new
  src/auth-instance.ts factory, which both `/api/auth/*` and the session
  middleware now share). `Env` gained `ADMIN_EMAILS?` (secret-like — never
  a wrangler.jsonc `vars` entry, only `.dev.vars`/`wrangler secret put`)
  and `API_RATE_LIMITER?: RateLimit`.
- Middleware (src/middleware/): `requireSession` (401 JSON on no session);
  `requireOrganization` (org/role from `organization_members` via
  `getOrganizationsForUser` ONLY — V1 single-org rule, 403 `no_organization`
  when none) + `requireRole(role)` guard; `requireInternalAdmin`
  (ADMIN_EMAILS allowlist, case-insensitive/trimmed; 404 — not 401/403 —
  for every non-admin caller so the admin surface's existence is never
  revealed, docs/security.md C11); `rateLimitOrgApi` (native
  `API_RATE_LIMITER` binding on `/api/org/*`, IP-keyed, tolerant of a
  missing binding — logs once and skips rather than failing closed/open).
- Routes (src/routes/, zod-validated via `@hono/zod-validator` 0.9.0, new
  dep): `POST /api/org` (create org + OWNER membership, 409 if the user
  already has one — V1 single-org rule); `GET/PUT /api/org/profile` (PUT
  OWNER-only, closed zod schema — unknown fields incl. a client-supplied
  `organizationId` are rejected 400, never honored); `GET/PUT
/api/org/keywords` (PUT OWNER-only, `CapExceededError` → 422
  `{error:'cap_exceeded',cap}`); `DELETE /api/account` (409
  `transfer_or_delete_organization_first` for a sole OWNER — checked via
  new `countOrganizationOwners`, not just "has an OWNER row", so it stays
  correct if multi-owner orgs ever ship; otherwise removes memberships then
  calls Better Auth's deleteUser); `/api/admin/health-details` placeholder
  (real admin tooling is Phase 10). All handlers read `organizationId`
  from `c.var` only; every write goes through a repository function.
- packages/db/src/repositories/identity.ts: three additions, all
  `(db, organizationId, ...)`-shaped (no structural-contract-test
  exemption needed) — `addOrganizationMember` (no invite UI in V1; exists
  for org bootstrap + MEMBER-role test seeding), `removeOrganizationMember`
  (double-scoped delete), `countOrganizationOwners`.
- wrangler.jsonc: `[[ratelimits]]` binding `API_RATE_LIMITER`
  (namespace_id 1001, simple 100 req/60s) — confirmed working in BOTH the
  pool-workers 0.21 test runtime (miniflare's ratelimit plugin picked it up
  from `wrangler.jsonc` via `configPath`, no test-only override needed) and
  `wrangler deploy --dry-run` bindings output; middleware still guards the
  missing-binding case per the plan for any environment where it isn't
  true.
- Tests: `apps/worker/src/tenancy.test.ts`, 8 tests, real workerd + local
  D1, covering every SEC-P3-04 bullet — unauthenticated 401 on every
  `/api/org/*` route and 404 on `/api/admin/*`; B never reads/writes A's
  profile row (asserted both via HTTP response AND a direct repository
  read of A's row before/after); query-string `organizationId` ignored on
  GET, JSON-body `organizationId` rejected 400 on PUT (both leave A
  untouched); MEMBER role → 403 on PUT profile (member row seeded via the
  new `addOrganizationMember`); admin gate 404 for a normal user / 200 for
  the ADMIN_EMAILS test user; keywords cap 51 → 422 with zero rows
  persisted; account deletion 409 for a sole OWNER, 204 + D1 row gone +
  subsequent session check 401 for a memberless user.
- Deliberate scope note: account deletion only removes
  `organization_members` rows before calling Better Auth's deleteUser
  (matches what V1 actually populates for a self-deleting user); a broader
  user-reference sweep (`support_notes.author_user_id`,
  `feature_flags.updated_by_user_id`, admin-only tables) is out of scope
  here and would only matter for an INTERNAL_ADMIN account, which Phase 10
  owns.
- Gates (all executed 2026-08-14, real output): `pnpm format` (1 file
  reformatted, the new test file) · `pnpm format:check` PASS ·
  `pnpm lint` PASS · `pnpm typecheck` PASS (14/14 workspace projects) ·
  `pnpm test` PASS — root 17 files/66, worker 3 files/18 (workerd+D1, incl.
  the new tenancy.test.ts), db 8 files/38 (workerd+D1) = 122 tests, zero
  skipped/deleted · `pnpm build` PASS (vite 17 modules; `wrangler deploy
--dry-run` lists `env.API_RATE_LIMITER (100 requests/60s)` alongside the
  existing bindings).

### Phase 4 review fixes (2026-08-14)

Targeted fixes from the security + production reviews of Phase 4 stage A/B —
no refactors, each read-before-edit.

- SEC-P4-01 (fixed): `apps/worker/wrangler.jsonc` — wrangler named
  environments do NOT inherit top-level bindings; `ratelimits` is now
  redeclared identically inside both `env.staging` and `env.production`.
  Verified with `wrangler deploy --dry-run --env staging`: bindings output
  now lists `env.API_RATE_LIMITER (100 requests/60s)` (it did not before).
- SEC-P4-02 (fixed): `apps/worker/src/index.ts` — `hono/body-limit`
  middleware bounds every `/api/*` request body to 128 KB before any route
  handler runs, returning a JSON 413 `{error:'payload_too_large'}`. New test
  in `tenancy.test.ts` (`SEC-P4-02`): `PUT /api/org/profile` with a >128 KB
  body → 413.
- SEC-P4-03 (fixed): `apps/worker/src/routes/org.ts` — `website` schema
  switched from `z.url()` to zod v4's built-in `z.httpUrl()` (verified from
  installed `zod/v4/classic/schemas` — restricts to the `http`/`https`
  protocol regex), so `javascript:`/other schemes can never be stored. New
  test (`SEC-P4-03`): `website: 'javascript:alert(1)'` → 400.
- SEC-P4-04 + P4-R-03 (fixed): `apps/worker/src/routes/account.ts` —
  membership removal still runs before `auth.api.deleteUser` (FK ordering
  unchanged), but the `account.deleted` audit event now writes only AFTER
  `deleteUser` succeeds, and `deleteUser` is wrapped in try/catch: on
  failure the removed membership rows are re-inserted (compensation) via the
  captured rows, the error is logged (no secrets) with the correlation id,
  and the handler returns 500 `{error:'account_deletion_failed'}`. The
  10-row membership fetch cap was removed — `getOrganizationsForUser` is now
  paginated to exhaustion so an OWNER row past a fixed page size can't
  silently escape the sole-OWNER guard.
- P4-R-02 (applied): `packages/auth/src/index.ts` sets
  `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']` (option path
  verified from installed `@better-auth/core/src/utils/ip.ts` — `getIp`
  walks `ipAddressHeaders` in order with NO fallback to
  `x-forwarded-for` once set, so the client-spoofable header is no longer
  consulted at all). `apps/worker/src/tenancy.test.ts` and
  `apps/worker/src/auth.test.ts` updated to key their per-test IP isolation
  off `cf-connecting-ip` instead of `x-forwarded-for`.
- SEC-P4-05 (documented, accepted for V1): TOCTOU race between the
  organization-existence check and the insert in `POST /api/org` — comment
  added at the check site; a partial unique index is scheduled with the
  next schema migration. Failure mode is an orphaned extra org, not a
  security issue, since `requireOrganization` deterministically picks the
  first org by id order.
- SEC-P4-08 (documented, accepted for V1): comments added at both
  `void deps.sendEmail(...)` call sites in `packages/auth/src/index.ts` —
  fire-and-forget is fine for the current logging-only dev/test provider,
  but the Phase 8 Resend provider MUST NOT rely on fire-and-forget on
  Workers (isolate teardown can drop the email); it needs
  `ExecutionContext.waitUntil` or a durable queue instead.
- SEC-P4-06 (tests added) in `apps/worker/src/tenancy.test.ts`: MEMBER role
  → 403 on `PUT /api/org/keywords`; a second `POST /api/org` by the same
  user → 409 `organization_exists`; `PUT /api/org/keywords` with an unknown
  top-level field → 400 (closed zod schema); `ADMIN_EMAILS`
  case-insensitivity exercised by reconfiguring the test binding to mixed
  case (`Admin@Example.test`) while the admin-gate test signs in with the
  lowercase form — 200.
- P4-R-01 (partial): smoke test added in `apps/worker/src/auth.test.ts` for
  `POST /api/auth/request-password-reset` (path verified from installed
  `better-auth` source, `dist/api/routes/password.mjs`) — 200 for an
  existing verified user, confirms the logging email provider was invoked
  for that recipient, and confirms the token/reset-url never appear in
  worker logs (C10). Full token-roundtrip reset (actually consuming the
  token via `/reset-password`) stays deferred to Phase 12 E2E — no test
  harness currently exposes the generated token outside the (intentionally
  unlogged) email body.
- Gates (all executed 2026-08-14, real output): `pnpm format` (reformatted
  1 file, the new auth.test.ts additions) · `pnpm format:check` PASS ·
  `pnpm lint` PASS (0 errors) · `pnpm typecheck` PASS (14/14 workspace
  projects) · `pnpm test` PASS — root 17 files/66 tests, worker 3 files/24
  tests (workerd+D1, +6 over the prior 18), db 8 files/38 tests = 128 tests,
  zero skipped/deleted · `pnpm build` PASS (vite 17 modules; `wrangler
deploy --dry-run` for the top-level env AND `--env staging` both list
  `env.API_RATE_LIMITER`).

### Phase 5 — TED Ingestion (2026-08-14)

- **Stage A (packages/ted)**: TedClient (anonymous Search API v3,
  sequential, 500 ms spacing, exp backoff + jitter honoring Retry-After,
  max 4 retries, hard request budget → TedBudgetExceededError, ITERATION
  iterator with stalled-token guard, fetchNoticeXml host-allowlisted to
  https *.ted.europa.eu + 15 MB size cap SEC-P5-01). eForms parser
  (fast-xml-parser 5.10; DTD rejected + strict validator — XXE/billion-
  laughs closed; namespace-prefix-agnostic navigation; OPT-300 buyer
  resolution; lot→procedure CPV/NUTS fallback; multilingual {lang→text}
  maps preserved; UTC deadlines; CPV check-digit stripping; version-
  tolerant 1.13–1.15 with warnings outside; TedParseError carries
  ParseIssue[] with 1 KB message truncation SEC-P5-04; 100k text caps;
  never fabricates — explicit nulls).
- **Fixtures**: 12 sanitized official OP-TED SDK examples under
  tests/fixtures/ted/{1.15,1.13}/ with meta.json (provenance, sdk tag,
  sanitization): normal, multi-lot, missing-value, missing-deadline,
  non-english, multilingual (24 langs), unexpected-optional-fields,
  published-publication-id, malformed-truncated (derived, documented),
  normal-corrected (derived), second-schema-version (1.13.2). Live
  published-TED fixtures pending network access (TED-P5-02).
- **Stage B (packages/procurement + worker)**: feature-flag-driven
  IngestionScope (default 72/48/79417000) + pause flag (fail-open on
  malformed JSON, warn-logged P5-R-03); buildScopeQuery (syntax pending
  live checkQuerySyntax — see gates below); bounded day-window catch-up
  (≤3 windows/run, stops at first failure); runIngestionWindow: search →
  fetch XML → sha-256 + gzip → R2 snapshot (ADR-0005 deterministic keys;
  publication-number validated two-tier SEC-P5-02) → parse → Search-row
  overrides → alpha-3→alpha-2 country map → upsert notice/version/lots/
  cpv/geo; TedParseError/XML_TOO_LARGE → ingestion_errors (detail_json
  capped 50 KB) + partial status, window proceeds; checkpoint advances
  only on full success (SQL-guarded advance-only). Retention purge:
  deadline+90d / no-deadline publication+180d, saved/feedback-pinned
  exempt, notice-granular, batch-bounded 500, FK-safe order, snapshots
  retained (R2 lifecycle owns objects); repositories/retention.ts global
  exemption documented + insert-ban asserted (SEC-P5-03). Worker: queues
  (INGEST_QUEUE + DLQ) / R2 (SNAPSHOTS) / crons (ingest 05:00, retention
  06:30, stale watchdog 09:00 UTC) in top-level AND both env blocks;
  scheduled()/queue() dispatch; /api/health/ready reports
  lastSuccessfulIngestionAt + stale (>36 h).
- **Deferred to Phase 6** (TED-P5-03): match recompute on new notice
  versions — listLotsForScoring already keys on current version; Phase 6
  scores post-ingestion.
- **OPEN honesty flags** (also in docs/deployment.md pre-first-ingestion
  gates): (1) composed expert-query syntax NOT validated against live
  checkQuerySyntax (TED API proxy-blocked from dev env) — must pass on
  staging before the production cron is enabled (TED-P5-01); (2) scoped
  daily volume UNMEASURED — planning number 150–300/day stands unverified;
  measure on first staging window, record in cost model, tighten-before-
  widen if >2× (ADR-0003); (3) purge eligibility scan is in-memory —
  fine ≤~50k lots, keyset pagination past that (P5-R-04).

## In progress

- Nothing mid-flight. Working tree committed at each checkpoint.

## Next (Phase 6 — Matching)

1. Deterministic engine in packages/matching per docs/matching-engine.md:
   hierarchical CPV gradient, capability/keyword matching (diacritic-fold,
   synonym groups), geography, value bands (ECB rates via exchange_rates),
   buyer/procedure/deadline/eligibility components; UNKNOWN=50% policy;
   hard exclusions (known values only); risk flags with evidence +
   confidence; ENGINE_VERSION stamped.
2. Scoring pipeline: post-ingestion enqueue → score (org × new/changed
   current-version lots, CPV-scope pre-filter), persist via
   insertTenderMatches (components only ≥ POSSIBLE_MATCH per spec).
3. Recompute path for corrected notices (TED-P5-03).
4. Unit tests per master spec list incl. worked example 84.5 as fixture;
   determinism property test; matching-audit skill + reviews.

## Architecture decisions

ADR-0001 Workers modular monolith / D1 / plain pnpm (no Turborepo).
ADR-0002 Better Auth 1.6.x + @better-auth/drizzle-adapter over D1;
org plugin for tenancy; nodejs_compat; rate-limit storage=database.
ADR-0003 Scoped ingestion (72*, 48*, 79417000 default) + deadline+90d
retention; widening = admin bounded backfill.
ADR-0004 Currency: EUR direct; ECB reference rates (≤7d old) for scoring
only; else UNKNOWN. Original values always displayed.
ADR-0005 Raw XML snapshots gzipped in private R2, 3-year lifecycle.
ADR-0006 Queues + Cron; Workflows rejected (per-step billing, no need).

## Dependencies added

Phase 2 (all per docs/dependency-versions.md pins): typescript ~5.9.2,
eslint 9 + typescript-eslint 8, prettier 3.6, vitest ^4.1, hono ^4.13,
wrangler ^4, @cloudflare/vitest-pool-workers ^0.21,
@cloudflare/workers-types ^5, react/react-dom ^19.2, vite ^8.2,
@vitejs/plugin-react ^6, zod ^4.4.3, drizzle-orm ~0.45.2 (declared, unused
until Phase 3), @playwright/test ^1.62. pnpm.onlyBuiltDependencies
[esbuild, workerd].

Phase 4 stage A: better-auth 1.6.29, @better-auth/drizzle-adapter 1.6.29
(packages/auth); @cloudflare/workers-types added as a devDependency to
packages/auth/notifications (needed for the `console`/`crypto` ambient
types once they compile packages/db/observability source directly).

Phase 4 stage B: @hono/zod-validator ^0.9.0, zod ^4.4.3 (apps/worker —
peer-compatible with hono ^4.13 and zod 4 per the installed package's
declared peerDependencies).

## Tests executed

Phase 2 final run (2026-08-14, all executed, all green): format:check PASS ·
lint PASS · typecheck PASS (14 projects) · test PASS (root vitest 15 files /
57 tests incl. new SEC-P2-01 hostile-getter test; worker pool-workers 1
file / 7 tests in workerd with real local D1) · build PASS (vite 17 modules;
wrangler deploy --dry-run) · db:migrate:local PASS (also verified from a
completely empty DB via fresh --persist-to dir by production-reviewer).

Phase 4 stage A final run (2026-08-14, all executed, all green):
format:check PASS · lint PASS · typecheck PASS (14/14 workspace projects) ·
test PASS (root vitest 17 files/66 tests; worker pool-workers 2 files/10
tests in workerd with real local D1, incl. new auth.test.ts; packages/db
pool-workers 8 files/38 tests in workerd with real local D1, incl. updated
migrations.d1.test.ts) — 114 tests total · build PASS (vite 17 modules;
wrangler deploy --dry-run, new APP_ENV/APP_BASE_URL/BETTER_AUTH_URL vars
listed in bindings output) · full migration chain (0001+0002+0003) verified
against a fresh scratch D1 and via `pnpm db:migrate:local`; drizzle-kit
generate afterward gives zero diff.

Phase 4 review fixes final run (2026-08-14, all executed, all green):
format:check PASS · lint PASS · typecheck PASS (14/14 workspace projects) ·
test PASS — root 17 files/66, worker 3 files/24 (workerd+D1), db 8 files/38
(workerd+D1) = 128 tests, zero skipped/deleted · build PASS (vite 17
modules; `wrangler deploy --dry-run` for both the top-level env and
`--env staging` list `env.API_RATE_LIMITER`, confirming SEC-P4-01).

## Known risks

- TED rate limits undocumented → self-imposed throttling; measure real
  behavior in Phase 5.
- Scoped-volume assumption (150–300/day) unmeasured → Phase 5 must measure
  before cost model is confirmed.
- match_components row growth is the D1 size driver → JSON-column fallback
  decision pre-recorded in data-model doc; revisit at 50 orgs.
- Imminent majors (Drizzle 1.0, Better Auth 1.7, Vitest 5, TS 7) — pinned
  to stables; watchlist in dependency-versions.md.
- Resend pricing figures unverified against resend.com (proxy-blocked);
  re-verify before Phase 8.
- eForms buyer resolution (OPT-300 indirection) is the trickiest parse path
  — needs real fixtures early in Phase 5.
- SEC-P4-05 (accepted): `POST /api/org`'s existence-check-then-insert is not
  atomic — two concurrent requests from the same user can both create an
  organization. Accepted for V1 (orphaned extra org, not a security issue);
  a partial unique index closing this race is scheduled with the next
  schema migration.
- SEC-P4-08 (accepted, must fix before Phase 8 ships): `packages/auth`'s
  `sendResetPassword`/`sendVerificationEmail` hooks call `sendEmail`
  fire-and-forget (`void`, not awaited) to avoid timing attacks. This is
  safe today because the only provider is the logging-only dev/test stub,
  but the Phase 8 Resend provider MUST route delivery through
  `ExecutionContext.waitUntil` (or a durable queue) — fire-and-forget on
  Workers can be torn down mid-flight and silently drop verification/reset
  emails.

## Human actions required

See HUMAN_DECISION_BLOCKERS.md (8 open items: Cloudflare account/token,
DNS + email auth records, Resend, Stripe, auth secret, admin allowlist,
business/legal info, GitHub branch protection). None block Phases 2–7.

## Security findings

None open. Threat model created (docs/threat-model.md) before architecture
finalization, per requirement.

## Cost changes

Baseline model established: ~$6/mo (0–10 customers), ~$26/mo (100),
~$30–105/mo (1,000) — see docs/cost-model.md. Within constraint.

## Deployment state

Nothing deployed. No Cloudflare resources exist yet.

## Reviewer sign-offs per phase

- Phase 0: **PASS** — production-reviewer, 2026-08-14. Docs-only phase;
  gates honestly N/A (no code); completeness/consistency/truthfulness
  verified independently.
- Phase 1: **PASS** — production-reviewer, 2026-08-14. Findings:
  P1-001 MEDIUM (matching example not table-derivable) → FIXED (example
  recomputed table-exact, 84.5 with derivations; will become a test
  fixture in Phase 6). P1-002 LOW (blocker count) → FIXED. P1-003 LOW
  (.env.example caught by deny glob) → FIXED (globs narrowed to real
  secret variants). P1-004 INFO → no change needed (security agent body
  already restricts Bash to test/lint, security.md agent line 14).
  P1-005 INFO (scope+retention share ADR-0003) → accepted, no action.
- Phase 2: **PASS** — production-reviewer, 2026-08-14 (re-ran every gate
  independently; findings P2-001 MEDIUM resolved by security review below,
  P2-002/003 deferrals recorded, P2-004/005 handled — see Phase 2 notes).
  **Security agent SIGN-OFF**, 2026-08-14: CSP/headers, logger redaction,
  env schema, wrangler config, repo-wide greps all pass; SEC-P2-01 LOW
  (logger throw path) FIXED same day with regression test; SEC-P2-02/03
  INFO tracked as conventions for Phases 4/6 and deploy time.
- Phase 3: **PASS** — production-reviewer, 2026-08-14 (re-ran all gates:
  111 tests, fresh-empty-DB migration proof, drizzle zero-drift proof,
  0001 untouched verified via git history; P3-R-001 resolved by security
  sign-off below; P3-R-002 resolved by this ledger update; P3-R-003 INFO
  noted in Phase 3 section; P3-R-004 verified-correct idempotency
  handling, no action). **Security agent SIGN-OFF (tenant-isolation
  audit)**, 2026-08-14: grep audit + migration constraint audit + test
  audit all PASS. SEC-P3-01 MEDIUM (feedback matchId cross-tenant
  reference) FIXED same day (org-check + TenantMismatchError + regression
  test); SEC-P3-02 LOW FIXED (FK-enforcement sentinel test); SEC-P3-03
  INFO (future digest_items repo must scope through parent) and
  SEC-P3-04 INFO (endpoint-level isolation tests are a Phase 4 hard
  requirement) carried into Phase 4 plan.
- Phase 4: **PASS** — production-reviewer, 2026-08-14 (all gates re-run
  independently: 122 tests pre-fixes, fresh-empty-DB chain 0001–0003,
  drizzle zero-drift; findings P4-R-01 password-reset coverage → partial
  smoke test added, token roundtrip deferred to Phase 12 E2E; P4-R-02
  cf-connecting-ip keying → applied; P4-R-03 audit ordering → fixed).
  **Security agent SIGN-OFF**, 2026-08-14 (0 CRITICAL/HIGH): grep audit
  clean, org context strictly membership-derived, admin gate cloaked, no
  token logging. SEC-P4-01 (env rate-limit bindings), SEC-P4-02 (body
  limit), SEC-P4-03 (URL scheme) MEDIUMs FIXED same day; SEC-P4-04
  deletion ordering FIXED (audit-after-success + compensation); SEC-P4-05
  TOCTOU documented-accepted; SEC-P4-06 test gaps closed (4 tests);
  SEC-P4-07 admin auditing scheduled with Phase 10 tooling; SEC-P4-08
  email waitUntil requirement recorded for Phase 8; SEC-P4-09 threat-model
  deltas noted for next touch. Final post-fix gates: 128 tests green.

## Pilot checkpoint

Not reached (after Phase 8).

## Notes

- Tags `phase-0-complete` / `phase-1-complete` created locally; pushing tags
  returns HTTP 403 (session credentials are scoped to the working branch
  only). Phase completion is authoritatively recorded here and in commit
  history; re-push tags from an environment with tag permissions, or tag on
  merge to the default branch.

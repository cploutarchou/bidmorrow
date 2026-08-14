# IMPLEMENTATION LEDGER

Source of truth for cross-session state. Update before every session end /
context compaction. Read first in every session.

## Current phase

**Phase 2 — Foundation: COMPLETE (signed off).** Next: Phase 3 — Database.

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

## In progress

- Nothing mid-flight. Working tree committed at each checkpoint.

## Next (Phase 3 — Database)

1. Drizzle schema in packages/db per docs/data-model.md (reconcile with the
   doc; doc updated where implementation diverges deliberately).
2. Real migrations replacing 0001 bootstrap (migration-safety skill; CI
   applies chain from empty DB — already wired).
3. Repository layer: organizationId-REQUIRED functions for all tenant-owned
   tables (grep-auditable per docs/security.md C6).
4. Seed/demo fixtures ("Acme Cyber Consulting", clearly marked demo data,
   never auto-seeded in production).
5. Integration tests via pool-workers real D1: repositories, migrations from
   empty + upgrade path, tenant-scoping negative tests.
6. Re-run tenant-isolation-audit (security agent) once repositories exist.

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

## Tests executed

Phase 2 final run (2026-08-14, all executed, all green): format:check PASS ·
lint PASS · typecheck PASS (14 projects) · test PASS (root vitest 15 files /
57 tests incl. new SEC-P2-01 hostile-getter test; worker pool-workers 1
file / 7 tests in workerd with real local D1) · build PASS (vite 17 modules;
wrangler deploy --dry-run) · db:migrate:local PASS (also verified from a
completely empty DB via fresh --persist-to dir by production-reviewer).

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

## Pilot checkpoint

Not reached (after Phase 8).

## Notes

- Tags `phase-0-complete` / `phase-1-complete` created locally; pushing tags
  returns HTTP 403 (session credentials are scoped to the working branch
  only). Phase completion is authoritatively recorded here and in commit
  history; re-push tags from an environment with tag permissions, or tag on
  merge to the default branch.

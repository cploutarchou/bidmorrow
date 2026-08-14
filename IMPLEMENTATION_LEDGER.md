# IMPLEMENTATION LEDGER

Source of truth for cross-session state. Update before every session end /
context compaction. Read first in every session.

## Current phase

**Phase 1 — Product/Architecture: COMPLETE pending reviewer sign-off.**
Phase 0 (research) complete. Next session: Phase 2 — Foundation.

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

## In progress

- Nothing mid-flight. Working tree committed at each checkpoint.

## Next (Phase 2 — Foundation)

1. pnpm workspace + package skeletons per docs/architecture.md structure.
2. TypeScript strict base config (pin TS 5.9.x — see dependency-versions).
3. apps/worker: Hono app skeleton, wrangler.jsonc (envs, D1/Queues/R2/assets
   bindings, nodejs_compat), health endpoints.
4. apps/web: Vite + React 19 skeleton served via Static Assets.
5. Vitest 4 + @cloudflare/vitest-pool-workers 0.21 (Vite-plugin style,
   `cloudflareTest()`); Playwright scaffold.
6. GitHub Actions PR pipeline: frozen install, format (prettier), lint
   (eslint), typecheck, tests, gitleaks, build.
7. Root scripts: format:check, lint, typecheck, test, build,
   db:migrate:local.
8. Verify the .claude PostToolUse typecheck hook fires correctly once
   packages exist.

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

None yet (no code). Pinned targets recorded in docs/dependency-versions.md.

## Tests executed

None — no code exists yet. (No test claims made.)

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

See HUMAN_DECISION_BLOCKERS.md (7 open items: Cloudflare account/token,
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

- Phase 0: pending production-reviewer (docs-only phase; gates N/A — no
  code). To be run at end of the Phase 0/1 session.
- Phase 1: pending production-reviewer.

## Pilot checkpoint

Not reached (after Phase 8).

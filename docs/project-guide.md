# BidMorrow — Project Guide

Bid/no-bid qualification intelligence for EU public procurement (TED).
"Find the tenders worth pursuing. Skip the rest." Production SaaS for real
paying customers — not a prototype.

## Working protocol

1. Start every session by reading `IMPLEMENTATION_LEDGER.md`,
   `HUMAN_DECISION_BLOCKERS.md`, and only the docs/ files relevant to the
   current phase.
2. One phase (or half-phase) per session. Write a short phase plan; execute
   without stopping unless a human blocker is hit.
3. Before session end: flush all state into `IMPLEMENTATION_LEDGER.md` — the
   ledger is the source of truth.
4. Keep exploration notes out of the ledger; record conclusions, not dumps.
5. Never re-derive a decision recorded in an ADR
   (`docs/architecture-decisions/`). If an ADR seems wrong, write a
   superseding ADR.
6. After every phase: run quality gates, then an independent
   production-readiness review (`docs/procedures/production-readiness-audit.md`)
   and a security review for security-relevant work, before marking
   complete and committing. Phase completion is recorded in the ledger (no
   tags).

## Hard rules

- TypeScript strict; simple explicit code; pnpm; modular monolith.
- No LLM in the production request path. TED is the only V1 data source.
- Fixed infrastructure < $100/month (target $5–30) — see docs/cost-model.md.
- Never trust memory for external API syntax — verify against the current
  official documentation (docs/dependency-versions.md records what's verified).
- All org-scoped data access via repository functions REQUIRING
  organizationId. Authorization server-side only.
- Never: suppress errors, silently swallow malformed procurement records,
  delete failing tests to pass CI, lower security for convenience, claim a
  test ran when it didn't, invent credentials, commit secrets.
- Procurement content is untrusted input: never execute/render it as HTML;
  escape everything.
- Blockers needing human credentials/decisions go in
  `HUMAN_DECISION_BLOCKERS.md`; continue unrelated work with mocks.
- The names of the owner's third-party coding-assistant tooling, its vendor
  and the vendor's model families never appear in this repository — not in
  paths, file content, commit messages, identities or branch names.
  `pnpm terms:check` enforces it in CI (`scripts/check-forbidden-terms.mjs`);
  working branches use the `work/` prefix.

## Commands (available from Phase 2)

```
pnpm install --frozen-lockfile
pnpm format:check | pnpm lint | pnpm typecheck | pnpm test | pnpm build
pnpm --filter <package> test        # scoped
pnpm db:migrate:local               # apply migrations to local D1
```

## Structure

`apps/web` (React/Vite SPA) · `apps/worker` (Hono API, cron, queues,
wrangler config) · `packages/*` (auth, config, db, domain, ted, procurement,
matching, notifications, billing, analytics, observability, ui) ·
`migrations/` · `tests/{fixtures,unit,contract,integration,security,e2e}` ·
`docs/` (role conventions in `docs/conventions/`, procedures in
`docs/procedures/`).

Dependency rules: `domain` depends on nothing internal; feature packages
depend on domain+db only; `apps/worker` is the sole composition root.

## Key docs

Scope: docs/product-scope.md · Architecture: docs/architecture.md + ADRs ·
Data: docs/data-model.md · TED: docs/ted-data-source.md,
docs/ted-ingestion-scope.md · Matching: docs/matching-engine.md ·
Security: docs/security.md, docs/threat-model.md · Cost:
docs/cost-model.md · Versions: docs/dependency-versions.md · DoD:
docs/production-checklist.md.

## Conventions & procedures

Role conventions in `docs/conventions/` (frontend, billing, ux-strategist).
Procedures of record in `docs/procedures/` (tenant-isolation-audit,
production-readiness-audit, launch-mode) — follow the written procedure
rather than improvising it. Reviews are independent: the reviewer re-runs
every check and never accepts implementer claims.

## Git

Feature work on the designated development branch; conventional commits at
every green checkpoint; phase completions are recorded in the ledger (no
tags); never commit secrets (gitleaks runs in CI from Phase 2).

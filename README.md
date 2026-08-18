# BidMorrow

**Find the tenders worth pursuing. Skip the rest.**

BidMorrow is bid/no-bid qualification intelligence for EU public
procurement. It ranks TED procurement opportunities against a company's
capabilities, geography, contract size and key requirements, so small IT,
cloud, software and cybersecurity consultancies can focus on the
opportunities that deserve a closer look.

BidMorrow is decision-support software: it does not guarantee tender
eligibility, compliance, or success, and customers must verify requirements
in the original procurement documents. Ingestion coverage is deliberately
scoped to documented CPV families (see docs/ted-ingestion-scope.md) — it is
not an exhaustive mirror of EU procurement.

## Status

Pre-launch, under active implementation. Progress and state:
`IMPLEMENTATION_LEDGER.md`. Human-required setup: `HUMAN_DECISION_BLOCKERS.md`.

## Stack

Cloudflare Workers (modular monolith) · Hono · React + Vite (Workers Static
Assets) · Cloudflare D1 + Drizzle ORM · Cloudflare Queues + Cron Triggers ·
R2 (raw notice snapshots) · Better Auth · Stripe (Checkout + Customer
Portal) · Resend · Vitest + Playwright · GitHub Actions + Wrangler.

Rationale for every major choice: `docs/architecture.md` and
`docs/architecture-decisions/`.

## Development

Requires Node 22+, pnpm 11+.

```bash
pnpm install --frozen-lockfile
pnpm dev            # wrangler dev (from Phase 2)
pnpm test           # all test suites
pnpm format:check && pnpm lint && pnpm typecheck && pnpm build
```

Secrets: copy `.env.example` names into `.dev.vars` / environment secrets —
values are never committed. See `docs/deployment.md`.

## Documentation map

| Topic                                     | Doc                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Product scope & exclusions                | docs/product-scope.md                                                                  |
| Architecture + ADRs                       | docs/architecture.md, docs/architecture-decisions/                                     |
| Data model                                | docs/data-model.md                                                                     |
| TED integration & ingestion scope         | docs/ted-data-source.md, docs/ted-ingestion-scope.md                                   |
| Matching engine                           | docs/matching-engine.md                                                                |
| Security & threat model                   | docs/security.md, docs/threat-model.md                                                 |
| Privacy                                   | docs/privacy.md                                                                        |
| Cost model                                | docs/cost-model.md                                                                     |
| Deployment / backup / runbook / incidents | docs/deployment.md, docs/backup-restore.md, docs/runbook.md, docs/incident-response.md |
| Definition of Done                        | docs/production-checklist.md                                                           |

## Data source & attribution

Procurement notices: Tenders Electronic Daily (TED), Publications Office of
the European Union — reused under Commission Decision 2011/833/EU with
source acknowledgement. BidMorrow is not affiliated with or endorsed by the
Publications Office of the EU.

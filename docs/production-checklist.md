# Production Readiness Checklist

Checkable mirror of the project's Definition of Done. Boxes are checked
ONLY during the Phase 14 production-readiness audit, each with evidence
(test run, command output, recorded drill) — never on intention. Work for
most items landed in Phases 1–13 (see IMPLEMENTATION_LEDGER.md); an
unchecked box means "not yet audit-verified", not "not done". This list
gates the production launch.

## Build & quality gates

- [ ] Reproducible install: `pnpm install --frozen-lockfile` clean on CI
- [ ] Build green for `apps/web` and `apps/worker`
- [ ] Format check green (no diffs)
- [ ] Lint green, including custom rules (dangerouslySetInnerHTML ban)
- [ ] Typecheck green, TypeScript strict everywhere

## Migrations

- [ ] All migrations apply cleanly to an empty DB and to a staging copy
- [ ] Migration procedure followed as documented (staging first; Time Travel
      bookmark before risky prod migrations) — docs/deployment.md
- [ ] No applied migration ever edited (roll-forward only)

## Auth & tenancy

- [ ] Email verification enforced before digest sending
- [ ] Password reset with anti-enumeration verified by tests
- [ ] Org context derived from session membership only; grep-audit confirms
      every org-scoped repository function requires `organizationId`
- [ ] Tenant-isolation test suite green (cross-org access attempts fail)
- [ ] INTERNAL_ADMIN behind `ADMIN_EMAILS` allowlist, separate route group,
      all actions audited

## TED ingestion

- [ ] Scope enforced exactly per docs/ted-ingestion-scope.md (form-type
      competition, CPV families, config-driven)
- [ ] Retention purge job runs, records counts, covered by integration tests
- [ ] Multi-schema-version eForms parsing verified against fixtures from
      all in-scope schema versions
- [ ] Idempotency: re-running any window produces zero duplicates
- [ ] Malformed notices surfaced in `ingestion_errors` — never silently
      skipped; run status never falsely successful
- [ ] Checkpoint advances only on full window success; measured daily volume
      recorded against the 150–300/day projection

## Matching

- [ ] Deterministic: same input → same score, verified by tests
- [ ] Explainable: every score decomposes into stored components
- [ ] Versioned: ENGINE_VERSION written on every match
- [ ] Unknown-policy: missing data yields UNKNOWN, never a guessed score
- [ ] Hard exclusions can never be outweighed by other components
- [ ] Every risk flag is source-backed (points at actual notice content)

## Customer product

- [ ] Core flows work end-to-end: signup → org setup → preferences →
      matches → saved tenders → digest
- [ ] Pagination everywhere; API p95 < 500 ms excluding upstream calls
- [ ] Scoped-coverage disclosure (methodology page) live and accurate

## Digest

- [ ] DB-enforced idempotency: unique (org, digest_date) proven by test
- [ ] Only-when-meaningful sending verified; unsubscribe works without login
- [ ] Delivery tracked in `email_deliveries` with bounded retries

## Billing

- [ ] Stripe webhook signature verification (`constructEventAsync`) — no
      unverified path exists
- [ ] Event-ID idempotency DB-enforced; state re-fetched from Stripe
- [ ] Entitlements enforced server-side; test/live modes never mixed

## Admin & ops

- [ ] Admin health page shows: ingestion runs, digest runs, queue/DLQ depth,
      D1 size vs limit, delivery failure rate
- [ ] Audit events written for every admin action and destructive customer
      action (append-only)
- [ ] `ingestion_paused` / `digest_paused` switches tested (pause + resume)

## Observability

- [ ] Structured logs with correlation IDs; secret/PII redaction verified
- [ ] DB-size alert at 60% of 10 GB wired and tested
- [ ] Stale-ingestion watchdog cron fires on a simulated stall

## Security

- [ ] Security review complete: 0 CRITICAL and 0 HIGH findings open
- [ ] Secret scan (gitleaks) green in CI; no secrets in repo history
- [ ] All controls C1–C11 (docs/security.md) verified against implementation
- [ ] Adversarial source-content fixtures pass (XSS/SQL/huge-token strings)

## Testing

- [ ] Unit, contract, integration, and security suites green
- [ ] Accessibility audit performed on the customer app (issues triaged)
- [ ] E2E critical path green (Playwright): signup → preferences → match
      view → digest received

## Deployment

- [ ] Staging deployed via CI; smoke tests green on staging
- [ ] Production deploy workflow protected (GitHub environment +
      deploy gate). ACCEPTED DEVIATION 2026-08-16: environment Required
      reviewers need GitHub Enterprise on private repos — gate is
      protected-branches-only + typed `confirm` input validated in-job +
      no-agent-dispatch convention (threat-model §5 residual)
- [ ] **D1 restore test performed on staging and documented**
      (docs/backup-restore.md drill — mandatory)
- [ ] Rollback drill performed (`wrangler rollback` on staging)
- [ ] Custom domain, Stripe live webhook, Resend SPF/DKIM/DMARC verified

## Cost

- [ ] Cost model current (prices re-verified within the last month)
- [ ] Projected run rate under $100/mo, including the 12-month D1 storage
      projection at expected customer count
- [ ] Guardrails in place: budgets, caps, pause flags, retention job

## Docs

- [ ] All docs/ files current and consistent with the implementation:
      architecture, security, deployment, backup-restore, runbook,
      incident-response, privacy, customer-support, cost-model,
      ted-ingestion-scope, data-model, ADRs
- [ ] HUMAN_DECISION_BLOCKERS.md: every item PROVIDED or explicitly DEFERRED
      with rationale — no OPEN launch blockers

# ADR-0003: Scoped TED ingestion + retention policy

Status: Accepted (2026-08-14)

## Context

TED publishes thousands of notices/day across all sectors. D1 caps a
database at 10 GB (verified 2026-08-14). Unscoped ingestion would collide
with that limit within roughly a year and would fill the product with
irrelevant tenders — directly against the product promise (relevance).

## Decision

1. **Ingest competition notices only** (form-type `competition`), within a
   **config-driven CPV scope**: default `72*` (IT services) + `48*`
   (software) + a small reviewed extras list (initial: 79417000 safety
   consultancy). Details + rationale: docs/ted-ingestion-scope.md.
2. **No country filter by default**; country filter exists in config as a
   budget lever.
3. **Retention**: normalized rows pruned 90 days after the last lot
   deadline passes (config `RETENTION_DAYS`; saved tenders exempt); raw
   XML snapshots remain in R2 (ADR-0005) for 3 years, so pruning is
   reversible in principle.
4. Scope widening = admin-only bounded backfill (≤90-day window per
   operation) through the normal pipeline; every change audited; cost-audit
   re-projection required, rejecting changes projecting past 60% of the D1
   limit at 12 months.

## Consequences

- Projected steady state ≤3–5 GB at 100 customers (docs/cost-model.md) —
  ≥50% headroom against the 10 GB limit.
- Coverage disclosure becomes a product/legal requirement (methodology +
  terms); never imply exhaustive coverage.
- Volume assumptions (150–300 notices/day in scope) are estimates until
  measured in Phase 5; measurement is a Phase 5 deliverable with a
  tighten-before-widen rule if reality exceeds 2× projection.

## Alternatives considered

- Ingest everything, filter at matching: burns the D1 limit for data no
  customer can match on; rejected.
- Per-customer dynamic scope (union of org CPV preferences): couples
  ingestion to customer churn, complicates dedupe/backfill, cold-starts
  every new vertical; config-driven global scope is simpler and auditable.
- Separate D1 database per year (sharding): premature; retention keeps a
  single database comfortably within limits at V1 scale.

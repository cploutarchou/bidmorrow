---
name: cost-audit
description: Audit infrastructure cost impact against the under-$100/month constraint and D1 size limits. Use when adding dependencies/platform features, during phase reviews, and whenever ingestion scope or retention settings change.
---

# Cost audit

Constraint: fixed infrastructure < $100/month during MVP; target $5–30/month;
alert threshold ~$60–80 projected run rate. Model of record: docs/cost-model.md.

## Checklist

1. Recompute the monthly projection at 0 / 10 / 100 / 1,000 customers for:
   Workers requests+CPU, D1 (reads/writes/storage), Queues operations, R2
   (storage/ops), Resend emails, any new component. Use CURRENT prices
   verified from official pricing pages (verify-current-docs) — record
   price-checked date.
2. D1 storage projection: rows/bytes per notice at current ingestion scope ×
   daily volume × 12 months, net of the retention policy. Compare against
   the verified per-database size limit; require ≥40% headroom at 12 months.
3. Payment processing fees modeled separately from fixed infrastructure.
4. Verify guardrails still enforced in code/config: bounded backfills, queue
   batch limits, max retries, keyword/CPV preference caps, admin-only large
   operations, digest batching, emergency pause switches, scope filter,
   retention job.
5. Any new dependency/service: is it free-tier viable, and what is the cost
   at 100 customers? Reject "fashionable but expensive" additions.
6. Update docs/cost-model.md with deltas and flag any projection crossing
   the $60–80 alert band.

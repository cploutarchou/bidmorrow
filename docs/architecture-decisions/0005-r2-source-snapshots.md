# ADR-0005: Raw notice snapshots in private R2

Status: Accepted (2026-08-14)

## Context

Parser bugs are inevitable across coexisting eForms SDK versions. Without the
original XML we cannot debug misparses or reprocess after a parser fix.
Storing raw XML in D1 would burn the 10 GB database limit (raw eForms XML is
typically 30–300 KB vs ~15 KB normalized).

## Decision

Store the **gzipped raw eForms XML of every ingested notice version** in a
**private R2 bucket** (`SNAPSHOTS` binding; per-environment buckets).

- Deterministic path: `ted/{publication-year}/{source_notice_id}/{version}.xml.gz`.
- `source_snapshots` row per object: R2 key, SHA-256 content hash (computed
  pre-compression), size, retrieved_at, eForms SDK version.
- Idempotent writes: same notice version re-fetched → hash compared; only
  changed content is re-written.
- Retention: snapshots outlive the D1 retention purge (they are the archive
  tier). R2 lifecycle rule deletes objects **3 years** after creation;
  bucket stays comfortably in the 10 GB free tier for years at scoped
  volume (~300/day × ~40 KB gzipped ≈ 4.4 GB/year → adjust lifecycle to
  2 years if the free tier nears exhaustion; tracked in cost-audit).
- Never public; access only via admin debug endpoints (audited) and the
  reprocessing job.

## Consequences

- Reprocessing after parser fixes is a bounded admin operation reading from
  R2, not re-hitting TED.
- Malformed records keep their raw payload for diagnosis (ingestion_errors
  references the snapshot key).
- ~2 R2 Class A ops per notice version — trivially within free tier.

## Alternatives considered

- No snapshots: parser bugs become unreproducible; rejected.
- Raw XML in D1: destroys the size budget; rejected.
- Snapshot only on parse failure: loses the reprocess-after-fix capability
  for successfully-but-wrongly parsed notices — the dangerous case.

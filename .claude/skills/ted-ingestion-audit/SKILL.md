---
name: ted-ingestion-audit
description: Audit the TED ingestion pipeline for idempotency, checkpoint safety, version handling, scope enforcement, and malformed-record surfacing. Use during phase review of ingestion work and when diagnosing ingestion incidents.
---

# TED ingestion audit

Verify each property against code and tests — not against descriptions.

## Checklist

1. **Idempotent**: re-running a window creates no duplicate notices/lots.
   Evidence: unique constraint on source notice ID + version; upsert logic;
   an integration test that runs the same window twice.
2. **Checkpointed**: checkpoint advances only after a window fully succeeds;
   a failed run leaves the checkpoint at the last safe point. Catch-up
   processes at most K windows per run (bounded).
3. **Version-aware**: corrected/changed notices create a new
   tender_notice_versions row; historical versions are never overwritten;
   the current-version pointer updates atomically; matches recompute for the
   new version.
4. **Scoped**: every TED query includes the configured CPV scope filter and
   COMPETITION notice-type filter; scope config comes from the database/admin
   config, not hardcoded; widening scope is admin-only and bounded.
5. **Bounded**: per-run request budget enforced; exponential backoff on TED
   errors/429; max retries; batch sizes limited.
6. **Malformed records surfaced**: parse failures land in ingestion_errors
   with the raw reference (and R2 snapshot key where enabled) — never
   silently skipped; run marked failed/partial, never falsely successful.
7. **Observable**: run rows record retrieved/created/updated/malformed
   counts, duration, and status; stale-ingestion alert fires when no
   successful run within the expected interval.
8. **Retention**: purge/archival job enforces the documented policy
   (docs/ted-ingestion-scope.md); archived notices retain R2 snapshots per
   snapshot policy.

Report per item: PASS/FAIL with file:line evidence and the test that proves it.

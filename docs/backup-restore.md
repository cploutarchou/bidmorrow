# Backup & Restore

Definitive backup/restore procedure. **Status: Phase 0/1 — no production
database exists; nothing here has been executed yet.** The staging restore
test [validate: Phase 13] is mandatory before this document may be treated
as proven.

## What protects what

| Data | Mechanism | Window |
|---|---|---|
| D1 (all application state) | D1 Time Travel — always-on, free, 30-day retention on paid plan | Any point in the last 30 days |
| R2 raw snapshots | Content is re-fetchable from TED for recent notices; otherwise see limitations below | — |
| Secrets/config | Not backed up by us — re-settable from provider dashboards (see incident-response.md secret procedure) | — |
| Code | Git (GitHub) + Workers version history | — |

## D1 Time Travel

- Always-on: no setup, no backup job to run or monitor. Point-in-time
  restore at roughly per-minute granularity within 30 days.
- **Capture a bookmark** (before risky operations, and to timestamp a known-
  good state):
  `wrangler d1 time-travel info bidmorrow-prod --env production`
  → record the printed bookmark in the deploy/incident log.
- **Restore** to a bookmark:
  `wrangler d1 time-travel restore bidmorrow-prod --env production --bookmark=<BOOKMARK>`
  or to a timestamp:
  `wrangler d1 time-travel restore bidmorrow-prod --env production --timestamp=<UNIX_OR_RFC3339>`
- Restoring itself creates a new bookmark first, so a restore can be undone
  by restoring again to the pre-restore bookmark. Still: treat restore as a
  serious action — it discards all writes after the target point.

## Objectives

Stated targets, to be validated by the Phase 13 staging drill — not yet
demonstrated:

- **RPO ≤ 5 minutes effective** (Time Travel granularity is ~per-minute
  within the 30-day window). [validate: Phase 13]
- **RTO ≤ 1 hour** for a full D1 restore including decision time, restore
  execution, and smoke verification. [validate: Phase 13]
- Anything older than 30 days is unrecoverable from Time Travel — long-term
  archival of TED content is R2's job; long-term archival of customer data
  beyond 30-day recovery is explicitly out of scope for V1.

## Scenario playbooks

### 1. Pre-migration recovery (planned safety net)
1. Before the migration: `wrangler d1 time-travel info … ` → record bookmark
   (mandatory step in docs/deployment.md migration procedure).
2. If the migration must be undone and roll-forward is not viable:
   `wrangler d1 time-travel restore … --bookmark=<recorded>`.
3. Re-run smoke tests; writes between bookmark and restore are lost —
   acceptable because the window is minutes and deploys are announced.

### 2. Accidental data deletion (operator or code bug)
1. Establish the deletion time from audit_events / logs.
2. **Pause writes to limit divergence**: set `ingestion_paused` and
   `digest_paused` flags (docs/runbook.md); consider brief maintenance mode
   if customer writes would be lost by a restore.
3. Small blast radius (one org's rows): prefer surgical repair — restore a
   **staging copy** to the pre-deletion point, extract the rows, re-insert
   into production. No full-restore data loss for other tenants.
4. Large blast radius: full restore to the minute before the deletion;
   communicate the lost-write window to affected users.
5. Unpause; record incident (docs/incident-response.md).

### 3. Bad migration (applied to production, wrong effect)
1. Default: **roll forward** — write a corrective migration, apply via the
   normal procedure. Restore is the fallback, not the reflex.
2. If data was destroyed and forward-fix cannot reconstruct it: restore to
   the pre-migration bookmark (playbook 1), then fix the migration, re-apply.
3. Never edit an already-applied migration file — the migrations table and
   staging/prod would diverge.

### 4. Bad deployment (code, not data)
1. `wrangler rollback` (or Dashboard → Deployments) to the previous Worker
   version — no D1 action needed if the bad code didn't corrupt data.
2. If the bad code wrote garbage: combine with playbook 2/3 — roll back
   code first, then repair data.

## R2 object recovery — limitations

**Decision (recorded here): bucket versioning is NOT enabled in V1.**
Consequences, accepted:

- A deleted or overwritten snapshot object is **unrecoverable** from R2.
- Mitigations that make this acceptable: snapshot paths are deterministic
  and content-hashed (ADR-0005) so overwrites are idempotent re-writes of
  identical content; recent notices are re-fetchable from TED; the app
  never depends on snapshots for serving customers (archive tier only);
  lifecycle deletion at 3 years is the only planned delete path, and no
  application code path deletes snapshot objects.
- Revisit trigger: if snapshots ever become a customer-facing or
  compliance-relevant record, enable R2 bucket versioning before that
  feature ships and update this section.

## Staging restore test [validate: Phase 13 — mandatory before production-ready]

Run on staging before the production launch, then quarterly:

1. Seed staging with realistic data; note a marker row + timestamp.
2. `wrangler d1 time-travel info bidmorrow-staging --env staging` → bookmark.
3. Write additional rows (the "to be lost" set), delete the marker row.
4. `wrangler d1 time-travel restore bidmorrow-staging --env staging --bookmark=<B>`.
5. Verify: marker row back, post-bookmark rows gone, app boots and serves
   (login + dashboard smoke), queues/crons resume cleanly.
6. Record measured restore duration → confirms or corrects the RTO target;
   file results in the ops log. A failed or never-run drill blocks the
   production-readiness checklist (docs/production-checklist.md).

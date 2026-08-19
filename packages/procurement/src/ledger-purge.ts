/**
 * SEC-P11-04: time-based ledger purge job — `audit_events` (24 months),
 * `email_deliveries` / `product_events` (12 months), per the retention
 * windows in docs/privacy.md's data inventory. The tenant-lifecycle
 * counterpart to `org-purge.ts` (which purges by ORG status, not by row
 * age); this job purges by row age regardless of organization status,
 * exactly like `purge.ts`'s tender-corpus retention sweep. Invoked from the
 * same daily retention cron path (`apps/worker/src/ingestion.ts`
 * `runRetentionPurgeJob`) as the other two, independently of both.
 *
 * SEC-P11-03 / P11-R-05 (docs/privacy.md, docs/threat-model.md): this is
 * what makes "`audit_events` retains pre-deletion org names/actor ids for
 * 24 months as deliberate security-forensics retention" a bounded claim
 * rather than an unbounded one — the ledger is append-only by design, but
 * not retained forever.
 *
 * ADR-0008 §3 closes the matching gap for the fetch-retry table: terminal
 * (`recovered`/`abandoned`) `ingestion_fetch_retries` rows purge on the same
 * 90-day window as the tender-corpus retention job (docs/ted-ingestion-scope.md
 * `RETENTION_DAYS`) — `pending` rows are NEVER purged by age (see
 * `purgeOldFetchRetries`'s own doc comment).
 */
import {
  purgeOldAuditEvents,
  purgeOldEmailDeliveries,
  purgeOldFetchRetries,
  purgeOldProductEvents,
} from '@bidmorrow/db';
import type { Db } from '@bidmorrow/db';
import type { Logger } from '@bidmorrow/observability';

const MS_PER_DAY = 86_400_000;

/** docs/privacy.md data inventory: `audit_events` retention window. */
export const AUDIT_EVENTS_RETENTION_DAYS = 24 * 30;
/** docs/privacy.md data inventory: `email_deliveries` / `product_events` retention window. */
export const ENGAGEMENT_LEDGER_RETENTION_DAYS = 365;
/** ADR-0008 §3: terminal `ingestion_fetch_retries` row retention window (matches docs/ted-ingestion-scope.md `RETENTION_DAYS`). */
export const FETCH_RETRIES_RETENTION_DAYS = 90;

/** Default per-run bound on rows purged, per table (config). */
export const DEFAULT_LEDGER_PURGE_BATCH_LIMIT = 1000;

export interface RunLedgerPurgeArgs {
  readonly db: Db;
  readonly logger: Logger;
  readonly now?: () => number;
  readonly limit?: number;
}

export interface RunLedgerPurgeResult {
  readonly auditEventsDeleted: number;
  readonly emailDeliveriesDeleted: number;
  readonly productEventsDeleted: number;
  readonly fetchRetriesDeleted: number;
}

/**
 * Purges rows older than each table's fixed retention window, bounded to
 * `limit` rows PER TABLE per run (not a shared budget — a burst in one
 * table's backlog must never starve the others). A repeated cron run makes
 * steady progress on any backlog rather than needing to finish one table
 * before starting another.
 */
export async function runLedgerPurge(args: RunLedgerPurgeArgs): Promise<RunLedgerPurgeResult> {
  const now = args.now ?? Date.now;
  const limit = args.limit ?? DEFAULT_LEDGER_PURGE_BATCH_LIMIT;
  const nowMs = now();

  const auditEventsDeleted = await purgeOldAuditEvents(args.db, {
    cutoffMs: nowMs - AUDIT_EVENTS_RETENTION_DAYS * MS_PER_DAY,
    limit,
  });
  const emailDeliveriesDeleted = await purgeOldEmailDeliveries(args.db, {
    cutoffMs: nowMs - ENGAGEMENT_LEDGER_RETENTION_DAYS * MS_PER_DAY,
    limit,
  });
  const productEventsDeleted = await purgeOldProductEvents(args.db, {
    cutoffMs: nowMs - ENGAGEMENT_LEDGER_RETENTION_DAYS * MS_PER_DAY,
    limit,
  });
  const fetchRetriesDeleted = await purgeOldFetchRetries(args.db, {
    cutoffMs: nowMs - FETCH_RETRIES_RETENTION_DAYS * MS_PER_DAY,
    limit,
  });

  const result: RunLedgerPurgeResult = {
    auditEventsDeleted,
    emailDeliveriesDeleted,
    productEventsDeleted,
    fetchRetriesDeleted,
  };
  args.logger.info('ledger_purge.completed', { limit, ...result });
  return result;
}

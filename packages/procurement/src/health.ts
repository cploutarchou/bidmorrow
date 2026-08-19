/**
 * Stale-ingestion detection (ted-ingestion-audit checklist item 7): feeds
 * both the `/api/health/ready` readiness surface and the watchdog cron.
 * ADR-0008 §5 extends the watchdog with three fetch-resilience alert
 * conditions, evaluated independently of staleness (a healthy `partial` day
 * — isolated skips, draining backlog, zero abandonments — must not alert;
 * any of (i)-(iii) is "degraded").
 */
import { TED_SOURCE_ID } from '@bidmorrow/ted';
import { countPendingFetchRetries, countRecentErrorsByCode, listRecentRuns } from '@bidmorrow/db';
import type { Db } from '@bidmorrow/db';

/** No successful run within this many hours is considered stale (docs/architecture.md background paths). */
export const STALE_INGESTION_HOURS = 36;

const MS_PER_HOUR = 3_600_000;

/** `finishedAt` of the most recent `succeeded`/`partial` run, or null if none exists yet. */
export async function lastSuccessfulRunAt(db: Db): Promise<number | null> {
  // Scans recent runs newest-first (bounded page); a healthy pipeline finds
  // one within the first few rows, so no dedicated index is needed yet.
  const page = await listRecentRuns(db, { source: TED_SOURCE_ID, limit: 50 });
  for (const run of page.items) {
    if ((run.status === 'succeeded' || run.status === 'partial') && run.finishedAt !== null) {
      return run.finishedAt;
    }
  }
  return null;
}

/** True when there is no successful run within `STALE_INGESTION_HOURS`. */
export function isIngestionStale(lastSuccessMs: number | null, nowMs: number): boolean {
  if (lastSuccessMs === null) {
    return true;
  }
  return nowMs - lastSuccessMs > STALE_INGESTION_HOURS * MS_PER_HOUR;
}

// ---------------------------------------------------------------------------
// ADR-0008 §5 fetch-resilience watchdog alert conditions
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** Codes that alert when seen within the lookback window (§5 condition i). */
const ALERTABLE_FETCH_ERROR_CODES = [
  'FETCH_FAILURE_THRESHOLD_EXCEEDED',
  'NOTICE_FETCH_ABANDONED',
] as const;

/** §5 condition (ii): pending retry backlog threshold. */
export const PENDING_RETRY_BACKLOG_ALERT_THRESHOLD = 50;

/** §5 condition (iii): consecutive-runs-with-fetch-failures threshold. */
export const CONSECUTIVE_FETCH_FAILED_RUNS_ALERT_THRESHOLD = 3;

/** How many recent runs are scanned for condition (iii) — comfortably above the threshold. */
const CONSECUTIVE_RUNS_SCAN_LIMIT = 20;

export interface FetchResilienceAlerts {
  /** (i): any `FETCH_FAILURE_THRESHOLD_EXCEEDED`/`NOTICE_FETCH_ABANDONED` in the last 24h. */
  readonly thresholdOrAbandonment: boolean;
  /** (ii): pending retry backlog > `PENDING_RETRY_BACKLOG_ALERT_THRESHOLD`. */
  readonly pendingRetryBacklog: boolean;
  /** (iii): `CONSECUTIVE_FETCH_FAILED_RUNS_ALERT_THRESHOLD`+ most-recent FINISHED runs all have `notices_fetch_failed > 0`. */
  readonly consecutiveFetchFailedRuns: boolean;
  /** True when ANY of (i)-(iii) is set — "degraded" per §5. */
  readonly degraded: boolean;
}

/**
 * Evaluates the three ADR-0008 §5 fetch-resilience watchdog conditions.
 * Read-only; never mutates. `nowMs` is injectable for tests.
 */
export async function checkFetchResilienceAlerts(
  db: Db,
  nowMs: number,
): Promise<FetchResilienceAlerts> {
  const [thresholdOrAbandonmentCount, pendingBacklog, recentRuns] = await Promise.all([
    countRecentErrorsByCode(db, {
      source: TED_SOURCE_ID,
      errorCodes: ALERTABLE_FETCH_ERROR_CODES,
      sinceMs: nowMs - MS_PER_DAY,
    }),
    countPendingFetchRetries(db),
    listRecentRuns(db, { source: TED_SOURCE_ID, limit: CONSECUTIVE_RUNS_SCAN_LIMIT }),
  ]);

  let consecutiveFetchFailedRuns = 0;
  for (const run of recentRuns.items) {
    if (run.status === 'running') {
      // Not yet finished — skip without breaking the streak.
      continue;
    }
    if (run.noticesFetchFailed > 0) {
      consecutiveFetchFailedRuns += 1;
      if (consecutiveFetchFailedRuns >= CONSECUTIVE_FETCH_FAILED_RUNS_ALERT_THRESHOLD) {
        break;
      }
      continue;
    }
    break;
  }

  const thresholdOrAbandonment = thresholdOrAbandonmentCount > 0;
  const pendingRetryBacklog = pendingBacklog > PENDING_RETRY_BACKLOG_ALERT_THRESHOLD;
  const consecutiveFetchFailedRunsAlert =
    consecutiveFetchFailedRuns >= CONSECUTIVE_FETCH_FAILED_RUNS_ALERT_THRESHOLD;

  return {
    thresholdOrAbandonment,
    pendingRetryBacklog,
    consecutiveFetchFailedRuns: consecutiveFetchFailedRunsAlert,
    degraded: thresholdOrAbandonment || pendingRetryBacklog || consecutiveFetchFailedRunsAlert,
  };
}

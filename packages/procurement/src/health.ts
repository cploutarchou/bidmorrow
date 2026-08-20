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

/**
 * Codes that alert when seen within the lookback window (§5 condition i).
 * `RENDER_PENDING_DEGRADED` (ADR-0009 §1) joins here rather than condition
 * (iii): a degraded-render day is a real upstream signal worth a same-day
 * alert, but it must not participate in (iii)'s genuine-fetch-failure
 * streak (a slow-render day is normal TED behavior, not TED refusing us).
 */
const ALERTABLE_FETCH_ERROR_CODES = [
  'FETCH_FAILURE_THRESHOLD_EXCEEDED',
  'NOTICE_FETCH_ABANDONED',
  'RENDER_PENDING_DEGRADED',
] as const;

/** §5 condition (ii): pending retry backlog threshold. */
export const PENDING_RETRY_BACKLOG_ALERT_THRESHOLD = 50;

/** §5 condition (iii): consecutive-runs-with-fetch-failures threshold. */
export const CONSECUTIVE_FETCH_FAILED_RUNS_ALERT_THRESHOLD = 3;

/** How many recent runs are scanned for condition (iii) — comfortably above the threshold. */
const CONSECUTIVE_RUNS_SCAN_LIMIT = 20;

export interface FetchResilienceAlerts {
  /** (i): any `FETCH_FAILURE_THRESHOLD_EXCEEDED`/`NOTICE_FETCH_ABANDONED`/`RENDER_PENDING_DEGRADED` (ADR-0009 §1) in the last 24h. */
  readonly thresholdOrAbandonment: boolean;
  /** (ii): pending retry backlog > `PENDING_RETRY_BACKLOG_ALERT_THRESHOLD`. */
  readonly pendingRetryBacklog: boolean;
  /**
   * (iii): `CONSECUTIVE_FETCH_FAILED_RUNS_ALERT_THRESHOLD`+ most-recent
   * FINISHED, non-empty (`notices_seen > 0`) runs all have
   * `notices_fetch_failed > 0`. Non-empty excludes both drain runs (always
   * `notices_seen = 0`, see the loop below) and genuinely empty windows —
   * neither carries a fetch-health signal for this streak.
   */
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
    // The ADR-0008 §3/A2 drain writes its OWN `ingestion_runs` row (so its
    // durable diagnostics/abandonments have a valid FK), interleaved
    // newest-first with the window runs this condition is actually about.
    // A drain run always has `noticesSeen = 0` (it processes retry-table
    // rows, not a search-derived window) and would otherwise ALWAYS read as
    // "not fetch-failed" (its own `noticesFetchFailed` reflects only its
    // own within-drain outcomes, decoupled from window health by design —
    // §A2 "drain outcomes never feed the §2 threshold") and break the
    // streak, masking exactly the degraded run of windows this alert
    // exists to catch. No schema discriminator exists for "this run came
    // from the drain, not a window" without a migration, so we use the
    // cheap proxy already true of every drain run: `noticesSeen === 0`.
    // An empty WINDOW (a real search day with 0 in-scope notices, e.g. a
    // TED-quiet weekend) also has `noticesSeen === 0` and is likewise
    // skipped here — deliberately: a day with nothing to fetch carries no
    // fetch-health signal either way, so treating it as "skip, don't break"
    // is correct for both cases, not just a drain-detection side effect.
    if (run.noticesSeen === 0) {
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

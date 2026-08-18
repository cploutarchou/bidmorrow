/**
 * Stale-ingestion detection (ted-ingestion-audit checklist item 7): feeds
 * both the `/api/health/ready` readiness surface and the watchdog cron.
 */
import { TED_SOURCE_ID } from '@bidmorrow/ted';
import { listRecentRuns } from '@bidmorrow/db';
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

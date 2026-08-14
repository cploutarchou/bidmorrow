/**
 * Bounded catch-up entry point (called by the daily ingestion cron/queue
 * consumer): computes at most K single-day windows since the last
 * checkpoint and runs them in order, stopping at the first `failed` window
 * so the checkpoint never skips ahead of an unprocessed day.
 */
import { TED_SOURCE_ID } from '@bidmorrow/ted';
import { getCheckpoint } from '@bidmorrow/db';

import { computeCatchUpWindows } from './checkpoint-windows';
import { isIngestionPaused, loadIngestionScope } from './scope';
import type { RunWindowDeps, RunWindowResult } from './run-window';
import { runIngestionWindow } from './run-window';

export interface RunCatchUpDeps extends Omit<RunWindowDeps, 'scope'> {
  /** Bounded windows per invocation (config, default 3). */
  readonly maxWindowsPerRun: number;
}

export interface RunCatchUpResult {
  readonly results: readonly RunWindowResult[];
  /** True when `ingestion_paused` short-circuited the run before any window ran. */
  readonly paused: boolean;
}

export async function runIngestionCatchUp(deps: RunCatchUpDeps): Promise<RunCatchUpResult> {
  if (await isIngestionPaused(deps.db, deps.logger)) {
    deps.logger.info('ingestion.paused', { source: TED_SOURCE_ID });
    return { results: [], paused: true };
  }

  const now = deps.now ?? Date.now;
  const checkpoint = await getCheckpoint(deps.db, { source: TED_SOURCE_ID });
  const windows = computeCatchUpWindows(
    checkpoint?.lastPublicationDate ?? null,
    now(),
    deps.maxWindowsPerRun,
  );

  const scope = await loadIngestionScope(deps.db);
  const results: RunWindowResult[] = [];
  for (const window of windows) {
    const result = await runIngestionWindow({ ...deps, scope }, window);
    results.push(result);
    if (result.status === 'failed') {
      // A failed window means the checkpoint did not advance — further
      // windows would re-process (or worse, skip past) the same day.
      break;
    }
  }
  return { results, paused: false };
}

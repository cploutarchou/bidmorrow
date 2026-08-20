/**
 * Bounded catch-up entry point (called by the daily ingestion cron/queue
 * consumer): computes at most K single-day windows since the last
 * checkpoint and runs them in order, stopping at the first `failed` window
 * so the checkpoint never skips ahead of an unprocessed day.
 */
import { TED_SOURCE_ID } from '@bidmorrow/ted';
import { getCheckpoint } from '@bidmorrow/db';

import { computeCatchUpWindows } from './checkpoint-windows';
import { drainFetchRetries } from './fetch-retry-drain';
import type { DrainFetchRetriesResult } from './fetch-retry-drain';
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
  /** Every freshly-created lot id across all windows AND the drain this invocation processed — the worker enqueues these to `MATCH_QUEUE`. */
  readonly newLotIds: readonly string[];
  /**
   * ADR-0008 §3/Amendment §A2 (cause-classified by ADR-0009 §2): the
   * fetch-retry drain result, or `null` when it did not run — either paused
   * (covered by `paused` above), or the catch-up loop above ended `failed`
   * for a SYSTEMIC/budget reason (`isSystemicWindowFailure`), or there were
   * simply no due rows (`drainFetchRetries` itself returns an empty result
   * in that case, still non-null here).
   */
  readonly drain: DrainFetchRetriesResult | null;
}

/**
 * ADR-0009 §2: classifies a `failed` window's `failureCode` by what it
 * evidences about the origin. `true` -> the origin just refused us a whole
 * window (or the shared request budget is spent) -> skip the drain
 * (politeness + no point hammering/spending budget on a guaranteed no-op).
 * `false` -> everything else, including `UNEXPECTED_WINDOW_ERROR` (a
 * persistence/normalization bug says nothing about TED — if persistence is
 * genuinely down the drain's own writes fail loudly, which is correct
 * surface-don't-swallow behavior) and the defense-in-depth window-level
 * `NOTICE_RENDER_PENDING` code (origin cooperating by definition; §1's
 * record-and-continue path should make this unreachable at window level,
 * but the classifier stays conservative and does not treat it as systemic).
 * `null`/`undefined` (no failure, or an unrecognized code) -> `false`.
 */
export function isSystemicWindowFailure(code: string | null | undefined): boolean {
  if (code === null || code === undefined) {
    return false;
  }
  if (code === 'REQUEST_BUDGET_EXCEEDED' || code === 'FETCH_FAILURE_THRESHOLD_EXCEEDED') {
    return true;
  }
  return code.startsWith('SEARCH_FETCH_') || code.startsWith('NOTICE_FETCH_');
}

export async function runIngestionCatchUp(deps: RunCatchUpDeps): Promise<RunCatchUpResult> {
  if (await isIngestionPaused(deps.db, deps.logger)) {
    deps.logger.info('ingestion.paused', { source: TED_SOURCE_ID });
    return { results: [], paused: true, newLotIds: [], drain: null };
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
  const newLotIds: string[] = [];
  let terminalFailureCode: string | null = null;
  for (const window of windows) {
    const result = await runIngestionWindow({ ...deps, scope }, window);
    results.push(result);
    newLotIds.push(...result.newLotIds);
    if (result.status === 'failed') {
      // A failed window means the checkpoint did not advance — further
      // windows would re-process (or worse, skip past) the same day. The
      // loop still stops here regardless of WHY it failed; only the drain's
      // skip decision below is cause-classified (ADR-0009 §2).
      terminalFailureCode = result.failureCode;
      break;
    }
  }

  // ADR-0009 §2: the drain runs AFTER catch-up in the same invocation, using
  // the SAME TedClient instance (shared budget, spacing, backoff),
  // and is skipped ONLY when the catch-up's terminal failure was systemic
  // (or, as already handled above, ingestion is paused) — an origin that
  // just refused us a whole window (or an already-spent budget) should not
  // be hammered/spent further. A non-systemic failure (e.g. an unexpected
  // persistence bug, or the defense-in-depth window-level render-pending
  // code) lets the drain run; `TedBudgetExceededError` mid-drain already
  // terminates it gracefully (rows stay due tomorrow — unchanged).
  let drain: DrainFetchRetriesResult | null = null;
  if (!isSystemicWindowFailure(terminalFailureCode)) {
    drain = await drainFetchRetries(deps);
    newLotIds.push(...drain.newLotIds);
  }

  return { results, paused: false, newLotIds, drain };
}

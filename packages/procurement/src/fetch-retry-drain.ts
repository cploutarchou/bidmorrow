/**
 * ADR-0008 §3 / Amendment §A2 — the fetch-retry drain: after the daily
 * catch-up loop, re-attempts up to `FETCH_RETRY_MAX_PER_RUN` due
 * `ingestion_fetch_retries` rows through the IDENTICAL fetch/snapshot/parse/
 * persist path (`processOneNotice`) the window uses, sharing the SAME
 * `TedClient` instance (budget, spacing, backoff) and the same
 * `MAX_RENDER_VISITS` render-pending cycling budget. Drain rows are
 * windowless by design (§3): they never touch the ingestion checkpoint and
 * never feed the §2 systemic-failure threshold.
 *
 * A drain "attempt" is a full render-visit CYCLE (Amendment §A2), not a
 * single fetch — TED's async render front-end makes a single fetch
 * deterministically a trigger-only 202 for a not-yet-cached notice, so a
 * single-fetch drain would burn the whole retry budget on trigger-only
 * responses. All due rows for this invocation form one shared
 * requeue-cycling work queue (identical structure to `runIngestionWindow`'s
 * own Phase 2), so one persistently-202 notice cannot starve the others of
 * cycling passes.
 *
 * Outcome semantics per row, evaluated once its cycle ends:
 * - the notice was fetched and persisted (or recorded a parse/oversized-XML
 *   diagnostic via the normal `ingestion_errors` path) -> `recovered`. The
 *   retry table's job is specifically to solve FETCH failures; a notice that
 *   fetches fine but fails to parse is independently diagnosable from its
 *   own `ingestion_errors` row and must not keep occupying a retry slot.
 * - the cycle exhausts on `TedRenderPendingError` or fails on
 *   `TedRequestError` -> one `recordFetchRetryFailure` (attempts += 1, linear
 *   daily backoff computed by the repository) with NO `ingestion_errors` row
 *   yet (§3) -> `attempts >= FETCH_RETRY_MAX_ATTEMPTS` abandons the row
 *   (`markFetchRetryAbandoned`) and writes exactly one durable
 *   `NOTICE_FETCH_ABANDONED` diagnostic carrying the retry row's history.
 * - `TedBudgetExceededError` during the drain terminates the drain ONLY
 *   (logged; due rows remain due tomorrow) — no window is in flight, so
 *   nothing here is window-fatal.
 *
 * ADR-0010 §5.2 — SUSPENDED POSTURE. While the operator-set
 * `fetch_retry_attempts_suspended` flag is on, the drain stops being a drain
 * and becomes a recovery probe: it pulls only
 * `FETCH_RETRY_SUSPENDED_CANARY_ROWS` due rows, and a render-pending cycle
 * exhaustion no longer increments `attempts`. The rationale is that
 * render-pending during a confirmed upstream outage is evidence about TED's
 * render farm, not about the notice — burning the notice's five attempts on
 * it abandons real procurement records for a failure that was never theirs.
 * Recovery detection is preserved (the canary rows are still fetched every
 * run, ~<=18 requests/day), and clearing the flag restores full behavior with
 * no attempts spent. `TedRequestError` outcomes are unaffected: an HTTP or
 * network failure is per-notice evidence whether or not an outage is running.
 */
import {
  TED_SOURCE_ID,
  TedBudgetExceededError,
  TedRenderPendingError,
  TedRequestError,
} from '@bidmorrow/ted';
import type { TedClient } from '@bidmorrow/ted';
import type { Logger } from '@bidmorrow/observability';
import type { Db, IngestionFetchRetry, IngestionRunTerminalStatus } from '@bidmorrow/db';
import {
  createRun,
  finishRun,
  listDueFetchRetries,
  markFetchRetryAbandoned,
  markFetchRetryRecovered,
  recordError,
  recordFetchRetryFailure,
} from '@bidmorrow/db';

import { todayUtc } from './checkpoint-windows';
import type { SearchRowFields } from './search-row';
import { isFetchRetryAttemptsSuspended } from './scope';
import type { IngestionScope } from './scope';
import {
  MAX_RENDER_VISITS,
  RENDER_RETRY_DELAY_MS,
  processOneNotice,
  truncateForDiagnostic,
} from './run-window';
import type { MutableCounts } from './run-window';

/** Bounded batch size for one drain invocation (ADR-0008 §3). */
export const FETCH_RETRY_MAX_PER_RUN = 25;

/** Failed re-attempts before a row is abandoned (ADR-0008 §3 give-up). */
export const FETCH_RETRY_MAX_ATTEMPTS = 5;

/**
 * Due rows one drain invocation touches while `fetch_retry_attempts_suspended`
 * is set (ADR-0010 §5.2). The drain becomes a recovery PROBE rather than a
 * drain: enough rows to detect that the upstream render channel came back,
 * few enough that a confirmed outage costs almost nothing. Upper bound per
 * run is `FETCH_RETRY_SUSPENDED_CANARY_ROWS * MAX_RENDER_VISITS` = 18
 * requests.
 */
export const FETCH_RETRY_SUSPENDED_CANARY_ROWS = 3;

export interface FetchRetryDrainDeps {
  readonly db: Db;
  readonly client: TedClient;
  /** R2 bucket binding for raw-XML snapshots (ADR-0005), shared with the window. */
  readonly snapshots: R2Bucket;
  readonly logger: Logger;
  /** Injected clock (test seam); defaults to `Date.now`. */
  readonly now?: () => number;
  /** Same test seam as `RunWindowDeps.renderRetryDelayMs`; defaults to `RENDER_RETRY_DELAY_MS`. */
  readonly renderRetryDelayMs?: number;
}

export interface DrainFetchRetriesResult {
  /** Due rows this invocation pulled off `ingestion_fetch_retries`. */
  readonly attempted: number;
  readonly recovered: number;
  readonly abandoned: number;
  /** Failed this cycle but not yet at `FETCH_RETRY_MAX_ATTEMPTS` — remains `pending`. */
  readonly stillPending: number;
  /** Freshly-created lot ids from recovered notices — the caller enqueues these to `MATCH_QUEUE`, same as a window. */
  readonly newLotIds: readonly string[];
  /** True when `TedBudgetExceededError` cut the drain short (rows past that point remain untouched, due again tomorrow). */
  readonly terminatedByBudget: boolean;
  /** Null when there were no due rows (no `ingestion_runs` row was created). */
  readonly runId: string | null;
  /**
   * True when `fetch_retry_attempts_suspended` was set for this invocation:
   * the batch was capped to the canary subset and render-pending outcomes did
   * not burn attempts (ADR-0010 §5.2).
   */
  readonly attemptsSuspended: boolean;
}

const EMPTY_RESULT: DrainFetchRetriesResult = {
  attempted: 0,
  recovered: 0,
  abandoned: 0,
  stillPending: 0,
  newLotIds: [],
  terminatedByBudget: false,
  runId: null,
  attemptsSuspended: false,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface DrainQueueEntry {
  readonly retry: IngestionFetchRetry;
  visits: number;
  notBefore: number;
}

/**
 * Records one drain-cycle failure (ADR-0008 §3): `attempts += 1` via the
 * repository's atomic UPDATE, then abandons + writes the durable
 * `NOTICE_FETCH_ABANDONED` diagnostic once `FETCH_RETRY_MAX_ATTEMPTS` is
 * reached. Returns whether the row is now terminal.
 */
async function recordDrainCycleFailure(
  deps: FetchRetryDrainDeps,
  ingestionRunId: string,
  retryRow: IngestionFetchRetry,
  errorCode: string,
  message: string,
  now: () => number,
  /**
   * ADR-0010 §5.2 — `fetch_retry_attempts_suspended` is set. A render-pending
   * outcome is then evidence about TED's render farm, not about this notice,
   * so it must not consume one of the row's five attempts. The row keeps its
   * `attempts` AND its `nextAttemptAt`, so it stays due and is re-probed on
   * the next run; nothing is lost when the flag clears. Genuine
   * `TedRequestError` outcomes are per-notice evidence and still burn.
   */
  attemptsSuspended: boolean,
): Promise<'abandoned' | 'still-pending'> {
  if (attemptsSuspended && errorCode === 'NOTICE_RENDER_PENDING') {
    deps.logger.info('ingestion.fetch_retry.attempt_suspended', {
      source_notice_id: retryRow.sourceNoticeId,
      attempts: retryRow.attempts,
      error_code: errorCode,
    });
    return 'still-pending';
  }
  const updated = await recordFetchRetryFailure(deps.db, {
    id: retryRow.id,
    errorCode,
    now: now(),
  });
  deps.logger.info('ingestion.fetch_retry.attempt', {
    source_notice_id: retryRow.sourceNoticeId,
    attempts: updated.attempts,
    error_code: errorCode,
  });
  if (updated.attempts < FETCH_RETRY_MAX_ATTEMPTS) {
    return 'still-pending';
  }
  await markFetchRetryAbandoned(deps.db, { id: retryRow.id, now: now() });
  await recordError(deps.db, {
    ingestionRunId,
    source: TED_SOURCE_ID,
    sourceNoticeId: retryRow.sourceNoticeId,
    stage: 'fetch',
    errorCode: 'NOTICE_FETCH_ABANDONED',
    message: truncateForDiagnostic(
      `notice XML fetch abandoned after ${String(updated.attempts)} retry attempts ` +
        `(last error ${errorCode}): ${message}`,
    ),
    detail: {
      attempts: updated.attempts,
      lastErrorCode: errorCode,
      xmlUrl: truncateForDiagnostic(retryRow.xmlUrl),
      publicationDate: retryRow.publicationDate,
      firstSkippedAt: retryRow.createdAt,
    },
  });
  deps.logger.error('ingestion.fetch_retry.abandoned', {
    source_notice_id: retryRow.sourceNoticeId,
    attempts: updated.attempts,
  });
  return 'abandoned';
}

/**
 * Drains up to `FETCH_RETRY_MAX_PER_RUN` due `ingestion_fetch_retries` rows.
 * Skipped entirely (empty result, no run created) when there are no due
 * rows. Ordering/skip rules (who calls this and when) live in the caller
 * (`catch-up.ts`): the drain must run AFTER catch-up and be skipped when
 * catch-up ended `failed` or ingestion is paused (Amendment §A2).
 */
export async function drainFetchRetries(
  deps: FetchRetryDrainDeps,
): Promise<DrainFetchRetriesResult> {
  const now = deps.now ?? Date.now;
  // ADR-0010 §5.2 — read BEFORE listing, so a suspended run also caps how many
  // rows it pulls: during a confirmed outage the drain is a recovery probe,
  // not a drain.
  const attemptsSuspended = await isFetchRetryAttemptsSuspended(deps.db, deps.logger);
  const dueRows = await listDueFetchRetries(deps.db, {
    limit: attemptsSuspended ? FETCH_RETRY_SUSPENDED_CANARY_ROWS : FETCH_RETRY_MAX_PER_RUN,
    now: now(),
  });
  if (dueRows.length === 0) {
    return EMPTY_RESULT;
  }

  const today = todayUtc(now());
  const run = await createRun(deps.db, {
    source: TED_SOURCE_ID,
    windowFrom: today,
    windowTo: today,
    startedAt: now(),
  });
  const counts: MutableCounts = {
    noticesSeen: 0,
    noticesUpserted: 0,
    versionsCreated: 0,
    lotsCreated: 0,
    matchesScored: 0,
    errorsCount: 0,
    noticesFetchFailed: 0,
    // Drain rows are windowless (ADR-0008 §3): neither the §2 threshold nor
    // the ADR-0009 §1 degraded-render signal applies to a drain run, so this
    // counter stays 0 here — `processOneNotice`'s render-pending cycling
    // inside the drain's own work queue is handled by `recordDrainCycleFailure`,
    // never by `recordRenderPendingSkip`/`recordFetchSkip`.
    noticesRenderPending: 0,
  };
  const newLotIds: string[] = [];
  const renderRetryDelayMs = deps.renderRetryDelayMs ?? RENDER_RETRY_DELAY_MS;

  const workQueue: DrainQueueEntry[] = dueRows.map((retry) => ({ retry, visits: 0, notBefore: 0 }));
  let recovered = 0;
  let abandoned = 0;
  let stillPending = 0;
  let terminatedByBudget = false;

  while (workQueue.length > 0) {
    const entry = workQueue.shift();
    if (entry === undefined) break;
    const waitMs = entry.notBefore - now();
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    const row: SearchRowFields = {
      sourceNoticeId: entry.retry.sourceNoticeId,
      publicationDate: entry.retry.publicationDate,
      xmlUrl: entry.retry.xmlUrl,
    };
    try {
      await processOneNotice(
        {
          db: deps.db,
          client: deps.client,
          snapshots: deps.snapshots,
          logger: deps.logger,
          scope: EMPTY_SCOPE,
          now,
        },
        run.id,
        row,
        counts,
        newLotIds,
        now,
        { swallowFetchErrors: false },
      );
      await markFetchRetryRecovered(deps.db, { id: entry.retry.id, now: now() });
      recovered += 1;
      deps.logger.info('ingestion.fetch_retry.recovered', {
        source_notice_id: entry.retry.sourceNoticeId,
        attempts: entry.retry.attempts,
      });
    } catch (cause) {
      if (cause instanceof TedBudgetExceededError) {
        terminatedByBudget = true;
        deps.logger.warn('ingestion.fetch_retry.budget_exhausted', {
          source_notice_id: entry.retry.sourceNoticeId,
          remaining_due: workQueue.length,
        });
        break;
      }
      if (cause instanceof TedRenderPendingError) {
        entry.visits += 1;
        if (entry.visits < MAX_RENDER_VISITS) {
          entry.notBefore = now() + renderRetryDelayMs;
          workQueue.push(entry);
          continue;
        }
        const outcome = await recordDrainCycleFailure(
          deps,
          run.id,
          entry.retry,
          'NOTICE_RENDER_PENDING',
          cause.message,
          now,
          attemptsSuspended,
        );
        if (outcome === 'abandoned') {
          abandoned += 1;
        } else {
          stillPending += 1;
        }
        continue;
      }
      if (cause instanceof TedRequestError) {
        const errorCode =
          cause.status === null
            ? 'NOTICE_FETCH_NETWORK_ERROR'
            : `NOTICE_FETCH_HTTP_${String(cause.status)}`;
        const outcome = await recordDrainCycleFailure(
          deps,
          run.id,
          entry.retry,
          errorCode,
          cause.message,
          now,
          attemptsSuspended,
        );
        if (outcome === 'abandoned') {
          abandoned += 1;
        } else {
          stillPending += 1;
        }
        continue;
      }
      // Unexpected (persistence/normalization) failure — surface, never swallow.
      throw cause;
    }
  }

  counts.errorsCount += abandoned;
  const status: IngestionRunTerminalStatus = counts.errorsCount > 0 ? 'partial' : 'succeeded';
  await finishRun(deps.db, { runId: run.id, status, counts, finishedAt: now() });
  deps.logger.info('ingestion.fetch_retry.drain_completed', {
    attempted: dueRows.length,
    recovered,
    abandoned,
    still_pending: stillPending,
    terminated_by_budget: terminatedByBudget,
    attempts_suspended: attemptsSuspended,
  });

  return {
    attempted: dueRows.length,
    recovered,
    abandoned,
    stillPending,
    newLotIds,
    terminatedByBudget,
    runId: run.id,
    attemptsSuspended,
  };
}

/**
 * `processOneNotice` requires an `IngestionScope` (used only by
 * `runIngestionWindow`'s own Phase 1 search-query construction, which the
 * drain never runs — retried rows already carry their `xmlUrl`). An empty
 * scope is a harmless placeholder; nothing in `processOneNotice` reads it.
 */
const EMPTY_SCOPE: IngestionScope = { cpvFamilies: [], countries: [] };

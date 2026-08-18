/**
 * Ingestion composition (Phase 5 stage B): wires `@bidmorrow/ted` +
 * `@bidmorrow/procurement` against the Worker's real bindings
 * (`env.DB`, `env.SNAPSHOTS`) for the cron/queue handlers in `index.ts`.
 * Kept out of `index.ts` so it stays independently testable.
 */
import { createDb } from '@bidmorrow/db';
import type { Logger } from '@bidmorrow/observability';
import { TedClient } from '@bidmorrow/ted';
import {
  isIngestionPaused,
  loadIngestionScope,
  refreshEcbRates,
  runIngestionCatchUp,
  runIngestionWindow,
  runLedgerPurge,
  runOrgPurge,
  runPurge,
  scoreLotsForOrgs,
} from '@bidmorrow/procurement';
import type {
  RunCatchUpResult,
  RunLedgerPurgeResult,
  RunOrgPurgeResult,
  RunPurgeResult,
  RunWindowResult,
  ScoreLotsResult,
} from '@bidmorrow/procurement';

import type { Env, MatchQueueMessage } from './env';

/** Self-imposed per-run request budget (docs/ted-data-source.md flag #1 — no documented TED rate limit). */
const MAX_REQUESTS_PER_RUN = 2_000;
/** Bounded catch-up: at most this many single-day windows processed per cron/queue invocation. */
const MAX_WINDOWS_PER_RUN = 3;
/** Retention window past the last lot deadline (docs/ted-ingestion-scope.md `RETENTION_DAYS`). */
const RETENTION_DAYS = 90;
/** Bounded purge: at most this many notices deleted per invocation. */
const PURGE_BATCH_LIMIT = 500;
/** `MATCH_QUEUE` message batching — lot ids per `{kind:'score'}` message. */
const SCORE_MESSAGE_LOT_BATCH = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Daily ingestion catch-up: refreshes ECB exchange rates (ADR-0004, wired
 * BEFORE any scoring so value-fit conversion has the freshest rate
 * available), runs the bounded TED catch-up, then enqueues every freshly
 * created lot to `MATCH_QUEUE` in ≤100-id batches. Scoring itself never
 * runs inline here — it is a separate, decoupled queue consumer
 * (`runScoreJob`) so a slow/large scoring pass can never risk the
 * ingestion cron's own execution-time budget.
 */
export async function runIngestCatchUpJob(env: Env, logger: Logger): Promise<RunCatchUpResult> {
  const db = createDb(env.DB);

  const ecbResult = await refreshEcbRates({
    db,
    fetch: globalThis.fetch.bind(globalThis),
    logger,
  });
  logger.info('ingestion.ecb_refresh', { refreshed: ecbResult !== null });

  const client = new TedClient({
    fetch: globalThis.fetch.bind(globalThis),
    ...(env.TED_API_BASE_URL === undefined ? {} : { baseUrl: env.TED_API_BASE_URL }),
    ...(env.TED_API_KEY === undefined || env.TED_API_KEY === '' ? {} : { apiKey: env.TED_API_KEY }),
    budget: { maxRequestsPerRun: MAX_REQUESTS_PER_RUN },
    logger,
  });
  const result = await runIngestionCatchUp({
    db,
    client,
    snapshots: env.SNAPSHOTS,
    logger,
    maxWindowsPerRun: MAX_WINDOWS_PER_RUN,
  });

  for (const batch of chunk(result.newLotIds, SCORE_MESSAGE_LOT_BATCH)) {
    const message: MatchQueueMessage = { kind: 'score', lotIds: batch };
    await env.MATCH_QUEUE.send(message);
  }
  if (result.newLotIds.length > 0) {
    logger.info('ingestion.match_queue.enqueued', {
      new_lot_count: result.newLotIds.length,
      messages: Math.ceil(result.newLotIds.length / SCORE_MESSAGE_LOT_BATCH),
    });
  }

  return result;
}

/**
 * `INGEST_QUEUE` `{kind:'backfill_window'}` consumer (Phase 10 stage A,
 * `POST /api/admin/ingestion/backfill`): runs `runIngestionWindow` — the
 * SAME per-window function the daily catch-up cron uses — for exactly one
 * admin-supplied `[windowFrom, windowTo]` day, using the CURRENT ingestion
 * scope, then enqueues its new lots to `MATCH_QUEUE` (identical wiring to
 * `runIngestCatchUpJob`). Deliberately does NOT touch the ingestion
 * checkpoint's advance-only invariant path (`advanceCheckpoint` is still
 * called by `runIngestionWindow` itself for whichever window it processes —
 * an admin backfilling an OLDER day than the checkpoint would violate the
 * advance-only rule and throw, which is correct: backfill is for filling a
 * gap the automated catch-up has not reached yet, never for rewriting
 * history behind the checkpoint).
 */
export async function runBackfillWindowJob(
  env: Env,
  logger: Logger,
  window: { windowFrom: string; windowTo: string },
): Promise<RunWindowResult | null> {
  const db = createDb(env.DB);
  // P10-R-02: second enforcement layer — windows already queued when the
  // pause flag flips must not keep fetching/persisting TED data. `null`
  // means skipped-because-paused (logged); the message is acked, not
  // retried — the admin re-enqueues the backfill after resuming.
  if (await isIngestionPaused(db, logger)) {
    logger.warn('admin.backfill_window.skipped_paused', {
      window_from: window.windowFrom,
      window_to: window.windowTo,
    });
    return null;
  }
  const scope = await loadIngestionScope(db);
  const client = new TedClient({
    fetch: globalThis.fetch.bind(globalThis),
    ...(env.TED_API_BASE_URL === undefined ? {} : { baseUrl: env.TED_API_BASE_URL }),
    ...(env.TED_API_KEY === undefined || env.TED_API_KEY === '' ? {} : { apiKey: env.TED_API_KEY }),
    budget: { maxRequestsPerRun: MAX_REQUESTS_PER_RUN },
    logger,
  });
  const result = await runIngestionWindow(
    { db, client, snapshots: env.SNAPSHOTS, logger, scope },
    window,
  );
  for (const batch of chunk(result.newLotIds, SCORE_MESSAGE_LOT_BATCH)) {
    await env.MATCH_QUEUE.send({ kind: 'score', lotIds: batch });
  }
  logger.info('admin.backfill_window.completed', {
    window_from: window.windowFrom,
    window_to: window.windowTo,
    status: result.status,
    new_lot_count: result.newLotIds.length,
  });
  return result;
}

/**
 * Retention purge job. Runs TWO independent sweeps back to back — the
 * tender-corpus retention purge (`runPurge`, unchanged from Phase 5) and
 * the deleted-organization hard-purge (`runOrgPurge`, Phase 11 stage A,
 * docs/privacy.md commitment 3). Neither depends on the other's outcome;
 * a failure in one is never masked by the other silently succeeding — both
 * run inside this function's own try/catch-free body, so an exception in
 * either propagates to the caller (`index.ts`'s cron/queue handlers already
 * catch-and-log at that layer). The RETURNED shape stays `RunPurgeResult`
 * (tender-corpus counts only) for backward compatibility with existing
 * callers (`queue.purge.completed`'s `notices_deleted` log field); the org
 * purge's own counts are logged inside `runOrgPurge` itself
 * (`org_purge.completed`), not threaded through this return value.
 */
export async function runRetentionPurgeJob(env: Env, logger: Logger): Promise<RunPurgeResult> {
  const db = createDb(env.DB);
  const result = await runPurge({
    db,
    logger,
    retentionDays: RETENTION_DAYS,
    limit: PURGE_BATCH_LIMIT,
  });
  await runOrgPurge({ db, logger });
  // SEC-P11-04: time-based ledger purge (audit_events/email_deliveries/
  // product_events) — independent of the two purges above, same
  // "log the counts inside the job itself" pattern as `runOrgPurge`.
  await runLedgerPurge({ db, logger });
  return result;
}

/** Exposed separately for the D1 test suite (asserting org-purge counts directly, not just the log line). */
export async function runOrgPurgeJob(env: Env, logger: Logger): Promise<RunOrgPurgeResult> {
  const db = createDb(env.DB);
  return runOrgPurge({ db, logger });
}

/** Exposed separately for the D1 test suite (asserting ledger-purge counts directly, not just the log line). */
export async function runLedgerPurgeJob(env: Env, logger: Logger): Promise<RunLedgerPurgeResult> {
  const db = createDb(env.DB);
  return runLedgerPurge({ db, logger });
}

/**
 * SEC-P6-01: re-enqueues `result.remainingLotIds` (set only when
 * `MAX_PAIRS_PER_INVOCATION` truncated the run) to `MATCH_QUEUE` in
 * ≤100-id batches, so a capped invocation always finishes rather than
 * silently dropping the tail of a run. `messageKind`/`recompute` mirror
 * the mode of the run that produced `result`, per env.ts's
 * `MatchQueueMessage` doc (`recompute` continues as `recompute_continuation`,
 * never as a fresh `score`/`recompute`, to preserve hard-replace semantics).
 */
export async function enqueueScoreContinuation(
  env: Env,
  logger: Logger,
  result: ScoreLotsResult,
  recompute: boolean,
): Promise<void> {
  if (result.remainingLotIds.length === 0) {
    return;
  }
  const batches = chunk(result.remainingLotIds, SCORE_MESSAGE_LOT_BATCH);
  for (const batch of batches) {
    const message: MatchQueueMessage = recompute
      ? { kind: 'recompute_continuation', lotIds: batch }
      : { kind: 'score', lotIds: batch };
    await env.MATCH_QUEUE.send(message);
  }
  logger.info('scoring.continuation.enqueued', {
    remaining_lot_count: result.remainingLotIds.length,
    messages: batches.length,
    recompute,
  });
}

/** `MATCH_QUEUE` `{kind:'score'}` consumer: scores exactly the given lot ids for every eligible org. */
export async function runScoreJob(
  env: Env,
  logger: Logger,
  lotIds: readonly string[],
): Promise<ScoreLotsResult> {
  const db = createDb(env.DB);
  const result = await scoreLotsForOrgs({ db, logger }, { lotIds: [...lotIds] });
  await enqueueScoreContinuation(env, logger, result, false);
  return result;
}

/** `MATCH_QUEUE` `{kind:'recompute'}` consumer: re-scores (hard replace) the CURRENT-version lots of corrected notices. */
export async function runRecomputeJob(
  env: Env,
  logger: Logger,
  noticeIds: readonly string[],
): Promise<ScoreLotsResult> {
  const db = createDb(env.DB);
  const result = await scoreLotsForOrgs(
    { db, logger },
    { noticeIds: [...noticeIds], recompute: true },
  );
  await enqueueScoreContinuation(env, logger, result, true);
  return result;
}

/**
 * `MATCH_QUEUE` `{kind:'recompute_continuation'}` consumer: continues a
 * truncated recompute run by lot id (the notice->current-lot resolution
 * already happened in the run that produced these ids) — still hard-replace.
 */
export async function runRecomputeContinuationJob(
  env: Env,
  logger: Logger,
  lotIds: readonly string[],
): Promise<ScoreLotsResult> {
  const db = createDb(env.DB);
  const result = await scoreLotsForOrgs({ db, logger }, { lotIds: [...lotIds], recompute: true });
  await enqueueScoreContinuation(env, logger, result, true);
  return result;
}

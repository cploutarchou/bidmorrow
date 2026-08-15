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
  refreshEcbRates,
  runIngestionCatchUp,
  runPurge,
  scoreLotsForOrgs,
} from '@bidmorrow/procurement';
import type { RunCatchUpResult, RunPurgeResult, ScoreLotsResult } from '@bidmorrow/procurement';

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

export async function runRetentionPurgeJob(env: Env, logger: Logger): Promise<RunPurgeResult> {
  const db = createDb(env.DB);
  return runPurge({ db, logger, retentionDays: RETENTION_DAYS, limit: PURGE_BATCH_LIMIT });
}

/** `MATCH_QUEUE` `{kind:'score'}` consumer: scores exactly the given lot ids for every eligible org. */
export async function runScoreJob(
  env: Env,
  logger: Logger,
  lotIds: readonly string[],
): Promise<ScoreLotsResult> {
  const db = createDb(env.DB);
  return scoreLotsForOrgs({ db, logger }, { lotIds: [...lotIds] });
}

/** `MATCH_QUEUE` `{kind:'recompute'}` consumer: re-scores (hard replace) the CURRENT-version lots of corrected notices. */
export async function runRecomputeJob(
  env: Env,
  logger: Logger,
  noticeIds: readonly string[],
): Promise<ScoreLotsResult> {
  const db = createDb(env.DB);
  return scoreLotsForOrgs({ db, logger }, { noticeIds: [...noticeIds], recompute: true });
}

/**
 * Ingestion composition (Phase 5 stage B): wires `@bidmorrow/ted` +
 * `@bidmorrow/procurement` against the Worker's real bindings
 * (`env.DB`, `env.SNAPSHOTS`) for the cron/queue handlers in `index.ts`.
 * Kept out of `index.ts` so it stays independently testable.
 */
import { createDb } from '@bidmorrow/db';
import type { Logger } from '@bidmorrow/observability';
import { TedClient } from '@bidmorrow/ted';
import { runIngestionCatchUp, runPurge } from '@bidmorrow/procurement';
import type { RunCatchUpResult, RunPurgeResult } from '@bidmorrow/procurement';

import type { Env } from './env';

/** Self-imposed per-run request budget (docs/ted-data-source.md flag #1 — no documented TED rate limit). */
const MAX_REQUESTS_PER_RUN = 2_000;
/** Bounded catch-up: at most this many single-day windows processed per cron/queue invocation. */
const MAX_WINDOWS_PER_RUN = 3;
/** Retention window past the last lot deadline (docs/ted-ingestion-scope.md `RETENTION_DAYS`). */
const RETENTION_DAYS = 90;
/** Bounded purge: at most this many notices deleted per invocation. */
const PURGE_BATCH_LIMIT = 500;

export async function runIngestCatchUpJob(env: Env, logger: Logger): Promise<RunCatchUpResult> {
  const db = createDb(env.DB);
  const client = new TedClient({
    fetch: globalThis.fetch.bind(globalThis),
    ...(env.TED_API_BASE_URL === undefined ? {} : { baseUrl: env.TED_API_BASE_URL }),
    budget: { maxRequestsPerRun: MAX_REQUESTS_PER_RUN },
    logger,
  });
  return runIngestionCatchUp({
    db,
    client,
    snapshots: env.SNAPSHOTS,
    logger,
    maxWindowsPerRun: MAX_WINDOWS_PER_RUN,
  });
}

export async function runRetentionPurgeJob(env: Env, logger: Logger): Promise<RunPurgeResult> {
  const db = createDb(env.DB);
  return runPurge({ db, logger, retentionDays: RETENTION_DAYS, limit: PURGE_BATCH_LIMIT });
}

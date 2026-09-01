/**
 * GLOBAL repository — ingestion pipeline ops (docs/data-model.md §5).
 *
 * These tables are global operational metadata for the shared corpus
 * pipeline (no `organization_id`); per docs/security.md C6 no function here
 * takes an organizationId. The single ingestion cron/queue consumer
 * (ADR-0006) is the only writer.
 *
 * Invariants enforced here:
 * - run status transitions `running -> succeeded | partial | failed` ONLY;
 * - checkpoints ADVANCE only, never backwards (equal date allowed so the
 *   sequence token can move within a window);
 * - snapshot rows are inserted only for genuinely new content hashes;
 * - fetch-retry rows (ADR-0008 §3) upsert idempotently on
 *   `(source, source_notice_id)` WITHOUT ever resetting `attempts`, and only
 *   while the row is still `pending` — a `recovered`/`abandoned` row is
 *   terminal and a later re-skip of the same notice must not resurrect it;
 *   `recovered`/`abandoned` are one-way transitions out of `pending`, never
 *   reversed; a failed drain cycle reschedules on the hourly-geometric
 *   ladder (`fetchRetryBackoffMs`, ADR-0008 Amendment §A5).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';

import type { Db } from '../client';
import { newId } from '../id';
import {
  ingestionCheckpoints,
  ingestionErrors,
  ingestionFetchRetries,
  ingestionRuns,
  sourceSnapshots,
} from '../schema/ingestion';
import { assertIsoDate, normalizeLimit, toPage } from './shared';
import type { Page, Pagination } from './shared';

export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type IngestionCheckpoint = typeof ingestionCheckpoints.$inferSelect;
export type IngestionError = typeof ingestionErrors.$inferSelect;
export type SourceSnapshot = typeof sourceSnapshots.$inferSelect;
export type IngestionFetchRetry = typeof ingestionFetchRetries.$inferSelect;

/** Lifecycle state of a fetch-retry row (CHECK-backed, ADR-0008 §3). */
export type IngestionFetchRetryStatus = 'pending' | 'recovered' | 'abandoned';

/** Terminal states a running ingestion run may finish in (CHECK-backed). */
export type IngestionRunTerminalStatus = 'succeeded' | 'partial' | 'failed';

/** Pipeline stage of a row-level ingestion error (CHECK-backed). */
export type IngestionErrorStage = 'fetch' | 'parse' | 'map' | 'persist' | 'score';

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface CreateRunArgs {
  readonly source: string;
  /** `YYYY-MM-DD` inclusive publication window being processed. */
  readonly windowFrom: string;
  readonly windowTo: string;
  /** Defaults to now. */
  readonly startedAt?: number;
}

/** Creates a run in `running` status with zeroed counters. */
export async function createRun(db: Db, args: CreateRunArgs): Promise<IngestionRun> {
  assertIsoDate(args.windowFrom, 'windowFrom');
  assertIsoDate(args.windowTo, 'windowTo');
  const now = Date.now();
  const inserted = await db
    .insert(ingestionRuns)
    .values({
      id: newId(),
      source: args.source,
      status: 'running',
      windowFrom: args.windowFrom,
      windowTo: args.windowTo,
      startedAt: args.startedAt ?? now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const row = inserted[0];
  if (row === undefined) {
    throw new Error('createRun: insert returned no row');
  }
  return row;
}

export interface FinishRunArgs {
  readonly runId: string;
  readonly status: IngestionRunTerminalStatus;
  readonly counts: {
    readonly noticesSeen: number;
    readonly noticesUpserted: number;
    readonly versionsCreated: number;
    readonly lotsCreated: number;
    readonly matchesScored: number;
    readonly errorsCount: number;
    /**
     * Per-notice XML fetch failures recorded as record-and-continue skips
     * (ADR-0008 §1/§5) — a subset of `errorsCount`, isolated so watchdog/
     * admin can distinguish "healthy partial" from "systemically degraded"
     * with one indexed read. Optional (defaults to 0) so this repository
     * change stays additive for the ADR-0008 §1 window-level caller
     * (packages/procurement/src/run-window.ts), landing separately.
     */
    readonly noticesFetchFailed?: number;
    /**
     * Per-notice render-pending exhaustions recorded as record-and-continue
     * skips (ADR-0009 §1) — split out of `noticesFetchFailed` because the
     * origin is cooperating (202/empty-body, render queued but slow), not
     * refusing, and must never count toward the ADR-0008 §2 systemic
     * fetch-failure threshold. Optional (defaults to 0) so this repository
     * change stays additive for the ADR-0009 §1 window-level caller
     * (packages/procurement/src/run-window.ts), landing separately.
     */
    readonly noticesRenderPending?: number;
  };
  /** Defaults to now. */
  readonly finishedAt?: number;
}

/**
 * Finishes a run with final counters. The UPDATE is guarded by
 * `status = 'running'`, so the only legal transition is
 * `running -> succeeded | partial | failed` (the arg type forbids any other
 * target). Finishing a missing or already-finished run throws — a re-fired
 * cron must never silently rewrite a completed run's outcome.
 */
export async function finishRun(db: Db, args: FinishRunArgs): Promise<IngestionRun> {
  const now = Date.now();
  const updated = await db
    .update(ingestionRuns)
    .set({
      status: args.status,
      noticesSeen: args.counts.noticesSeen,
      noticesUpserted: args.counts.noticesUpserted,
      versionsCreated: args.counts.versionsCreated,
      lotsCreated: args.counts.lotsCreated,
      matchesScored: args.counts.matchesScored,
      errorsCount: args.counts.errorsCount,
      noticesFetchFailed: args.counts.noticesFetchFailed ?? 0,
      noticesRenderPending: args.counts.noticesRenderPending ?? 0,
      finishedAt: args.finishedAt ?? now,
      updatedAt: now,
    })
    .where(and(eq(ingestionRuns.id, args.runId), eq(ingestionRuns.status, 'running')))
    .returning();
  const row = updated[0];
  if (row === undefined) {
    throw new Error(
      `finishRun: run ${args.runId} is not in 'running' status (missing or already finished)`,
    );
  }
  return row;
}

export interface ListRecentRunsArgs extends Pagination {
  /** Optional filter to one source. */
  readonly source?: string;
}

/**
 * Recent runs, newest first. Ordered by `id DESC` — ULIDs are time-sortable,
 * so PK order is creation order and the id is a stable single-column cursor
 * (no `started_at` tie-breaking needed).
 */
export async function listRecentRuns(
  db: Db,
  args: ListRecentRunsArgs = {},
): Promise<Page<IngestionRun>> {
  const limit = normalizeLimit(args.limit);
  const rows = await db
    .select()
    .from(ingestionRuns)
    .where(
      and(
        args.source === undefined ? undefined : eq(ingestionRuns.source, args.source),
        args.cursor === undefined ? undefined : lt(ingestionRuns.id, args.cursor),
      ),
    )
    .orderBy(desc(ingestionRuns.id))
    .limit(limit + 1);
  return toPage(rows, limit, (row) => row.id);
}

export interface HasActiveIngestionRunArgs {
  readonly source: string;
  /**
   * Only `running` rows started AT OR AFTER this instant count. A consumer
   * killed mid-run (Queues wall-clock limit, deploy, crash) never reaches
   * `finishRun`, so its row stays `running` forever; without a horizon one
   * such orphan would make every later caller believe ingestion is busy.
   */
  readonly sinceMs: number;
}

/**
 * True when an ingestion run for `source` is (plausibly) in flight: a
 * `running` row started within the caller's horizon (ADR-0008 Amendment
 * §A5 — the hourly standalone fetch-retry drain stands down while the
 * daily catch-up or an admin backfill is live, so two `TedClient`s never
 * hit TED concurrently and two drains never race on the same retry rows).
 * Served by `idx_ingestion_runs__source_started_at`. Best-effort by nature
 * (a check-then-act, not a lock) — the callers' own `status = 'pending'`
 * guards on the retry rows are the correctness backstop.
 */
export async function hasActiveIngestionRun(
  db: Db,
  args: HasActiveIngestionRunArgs,
): Promise<boolean> {
  const row = (
    await db
      .select({ id: ingestionRuns.id })
      .from(ingestionRuns)
      .where(
        and(
          eq(ingestionRuns.source, args.source),
          eq(ingestionRuns.status, 'running'),
          gte(ingestionRuns.startedAt, args.sinceMs),
        ),
      )
      .limit(1)
  )[0];
  return row !== undefined;
}

/**
 * Row-level errors for one run, newest first (admin ingestion debugging —
 * Phase 10 stage A). `id` is a time-sortable ULID, so PK-order is a stable
 * cursor with no extra column.
 */
export async function listErrorsForRun(
  db: Db,
  args: { readonly ingestionRunId: string } & Pagination,
): Promise<Page<IngestionError>> {
  const limit = normalizeLimit(args.limit);
  const rows = await db
    .select()
    .from(ingestionErrors)
    .where(
      and(
        eq(ingestionErrors.ingestionRunId, args.ingestionRunId),
        args.cursor === undefined ? undefined : lt(ingestionErrors.id, args.cursor),
      ),
    )
    .orderBy(desc(ingestionErrors.id))
    .limit(limit + 1);
  return toPage(rows, limit, (row) => row.id);
}

/**
 * Count of `ingestion_errors` rows matching any of `errorCodes` recorded at
 * or after `sinceMs` (ADR-0008 §5 watchdog condition (i):
 * `FETCH_FAILURE_THRESHOLD_EXCEEDED` / `NOTICE_FETCH_ABANDONED` in the last
 * 24h). `source` scopes to one ingestion source, matching every other
 * function in this module.
 */
export async function countRecentErrorsByCode(
  db: Db,
  args: {
    readonly source: string;
    readonly errorCodes: readonly string[];
    readonly sinceMs: number;
  },
): Promise<number> {
  if (args.errorCodes.length === 0) {
    return 0;
  }
  const row = (
    await db
      .select({ n: sql<number>`count(*)` })
      .from(ingestionErrors)
      .where(
        and(
          eq(ingestionErrors.source, args.source),
          inArray(ingestionErrors.errorCode, [...args.errorCodes]),
          gte(ingestionErrors.createdAt, args.sinceMs),
        ),
      )
  )[0];
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/** Returns the per-source cursor, or null before the first successful window. */
export async function getCheckpoint(
  db: Db,
  args: { readonly source: string },
): Promise<IngestionCheckpoint | null> {
  const row = (
    await db
      .select()
      .from(ingestionCheckpoints)
      .where(eq(ingestionCheckpoints.source, args.source))
      .limit(1)
  )[0];
  return row ?? null;
}

/**
 * Pure guard for the checkpoint advance-only rule; exported for unit tests.
 * Advancing to a LATER date always passes; the SAME date passes (the
 * sequence token may move within a window); an EARLIER date throws.
 * Comparison is lexicographic, which is chronological for validated
 * `YYYY-MM-DD` strings.
 */
export function assertCheckpointAdvance(
  currentDate: string,
  nextDate: string,
  source: string,
): void {
  assertIsoDate(nextDate, 'lastPublicationDate');
  if (nextDate < currentDate) {
    throw new Error(
      `advanceCheckpoint: refusing to move checkpoint for source "${source}" backwards ` +
        `from ${currentDate} to ${nextDate}`,
    );
  }
}

export interface AdvanceCheckpointArgs {
  readonly source: string;
  /** `YYYY-MM-DD` last fully-processed publication window. */
  readonly lastPublicationDate: string;
  /** Source-specific pagination/sequence token within the window. */
  readonly lastSequenceToken?: string | null;
}

/**
 * Creates or advances the per-source checkpoint. ADVANCE ONLY: moving
 * `last_publication_date` backwards throws (guard above) and the UPDATE is
 * additionally constrained to `last_publication_date <= next` so a racing
 * writer cannot regress the cursor either — a lost update here would
 * re-ingest whole windows or, worse, skip them after a manual reset.
 */
export async function advanceCheckpoint(
  db: Db,
  args: AdvanceCheckpointArgs,
): Promise<IngestionCheckpoint> {
  assertIsoDate(args.lastPublicationDate, 'lastPublicationDate');
  const now = Date.now();
  const existing = await getCheckpoint(db, { source: args.source });

  if (existing === null) {
    const inserted = await db
      .insert(ingestionCheckpoints)
      .values({
        id: newId(),
        source: args.source,
        lastPublicationDate: args.lastPublicationDate,
        lastSequenceToken: args.lastSequenceToken ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = inserted[0];
    if (row === undefined) {
      throw new Error('advanceCheckpoint: insert returned no row');
    }
    return row;
  }

  assertCheckpointAdvance(existing.lastPublicationDate, args.lastPublicationDate, args.source);

  const updated = await db
    .update(ingestionCheckpoints)
    .set({
      lastPublicationDate: args.lastPublicationDate,
      lastSequenceToken: args.lastSequenceToken ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(ingestionCheckpoints.id, existing.id),
        // SQL-level advance-only guard (lexicographic = chronological for
        // validated YYYY-MM-DD): a concurrent writer that already moved the
        // checkpoint further makes this a no-op instead of a regression.
        lt(ingestionCheckpoints.lastPublicationDate, args.lastPublicationDate),
      ),
    )
    .returning();
  const row = updated[0];
  if (row !== undefined) {
    return row;
  }
  // Equal date (token move within the window) or concurrent forward move:
  // re-apply the token only under the equal-date condition.
  const tokenUpdated = await db
    .update(ingestionCheckpoints)
    .set({ lastSequenceToken: args.lastSequenceToken ?? null, updatedAt: now })
    .where(
      and(
        eq(ingestionCheckpoints.id, existing.id),
        eq(ingestionCheckpoints.lastPublicationDate, args.lastPublicationDate),
      ),
    )
    .returning();
  const tokenRow = tokenUpdated[0];
  if (tokenRow === undefined) {
    throw new Error(
      `advanceCheckpoint: checkpoint for source "${args.source}" moved ahead of ` +
        `${args.lastPublicationDate} concurrently; refusing to regress it`,
    );
  }
  return tokenRow;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface RecordErrorArgs {
  readonly ingestionRunId: string;
  readonly source: string;
  /** Null for window-level errors not tied to a single notice. */
  readonly sourceNoticeId?: string | null;
  readonly stage: IngestionErrorStage;
  /** Stable machine code, e.g. `MISSING_CPV`. */
  readonly errorCode: string;
  readonly message: string;
  /** R2 key of the archived raw payload, when one exists (ADR-0005). */
  readonly snapshotR2Key?: string | null;
  /** Offending raw fragment / structured context; JSON-serializable. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

/**
 * Records a row-level failure that did not abort the run (a bad notice must
 * never stop the batch — docs/data-model.md §5). The raw-payload reference
 * (`sourceNoticeId` + `snapshotR2Key`) makes every error reproducible from
 * the archived snapshot. Append-only; rows are immutable.
 */
export async function recordError(db: Db, args: RecordErrorArgs): Promise<IngestionError> {
  const detail: Record<string, unknown> = { ...(args.detail ?? {}) };
  if (args.snapshotR2Key !== undefined && args.snapshotR2Key !== null) {
    detail['snapshotR2Key'] = args.snapshotR2Key;
  }
  const detailJson = Object.keys(detail).length > 0 ? JSON.stringify(detail) : null;

  const inserted = await db
    .insert(ingestionErrors)
    .values({
      id: newId(),
      ingestionRunId: args.ingestionRunId,
      source: args.source,
      sourceNoticeId: args.sourceNoticeId ?? null,
      stage: args.stage,
      errorCode: args.errorCode,
      message: args.message,
      detailJson,
      createdAt: Date.now(),
    })
    .returning();
  const row = inserted[0];
  if (row === undefined) {
    throw new Error('recordError: insert returned no row');
  }
  return row;
}

// ---------------------------------------------------------------------------
// Source snapshots (R2 payload metadata — ADR-0005)
// ---------------------------------------------------------------------------

export interface InsertSnapshotIfNewHashArgs {
  readonly source: string;
  readonly sourceNoticeId: string;
  readonly versionNumber: number;
  /** Deterministic R2 path `{source}/{yyyy}/{mm}/{source_notice_id}/v{n}.xml`. */
  readonly r2Key: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  /** Retention hint for the R2 lifecycle job. */
  readonly retainedUntilAt?: number | null;
}

export interface InsertSnapshotResult {
  readonly snapshot: SourceSnapshot;
  /** False when an undeleted snapshot with this content hash already existed. */
  readonly created: boolean;
}

/**
 * Inserts a snapshot metadata row only when the content is genuinely new for
 * `(source, source_notice_id)`: if an undeleted row with the same
 * `content_hash` exists, it is returned unchanged and the caller skips the
 * duplicate R2 write. Unique `r2_key` backstops double-insert races.
 */
export async function insertSnapshotIfNewHash(
  db: Db,
  args: InsertSnapshotIfNewHashArgs,
): Promise<InsertSnapshotResult> {
  const existing = (
    await db
      .select()
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.source, args.source),
          eq(sourceSnapshots.sourceNoticeId, args.sourceNoticeId),
          eq(sourceSnapshots.contentHash, args.contentHash),
          isNull(sourceSnapshots.deletedAt),
        ),
      )
      .orderBy(desc(sourceSnapshots.id))
      .limit(1)
  )[0];
  if (existing !== undefined) {
    return { snapshot: existing, created: false };
  }

  const now = Date.now();
  const inserted = await db
    .insert(sourceSnapshots)
    .values({
      id: newId(),
      source: args.source,
      sourceNoticeId: args.sourceNoticeId,
      versionNumber: args.versionNumber,
      r2Key: args.r2Key,
      contentHash: args.contentHash,
      sizeBytes: args.sizeBytes,
      contentType: args.contentType,
      retainedUntilAt: args.retainedUntilAt ?? null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const row = inserted[0];
  if (row === undefined) {
    throw new Error('insertSnapshotIfNewHash: insert returned no row');
  }
  return { snapshot: row, created: true };
}

// ---------------------------------------------------------------------------
// Fetch retries (ADR-0008 §3 — bounded per-notice XML fetch retry queue)
// ---------------------------------------------------------------------------

/** One hour in ms — the unit of the fetch-retry backoff ladder (ADR-0008 Amendment §A5). */
const HOUR_MS = 3_600_000;

/**
 * Hourly-geometric backoff (ADR-0008 Amendment §A5, superseding §3's linear
 * daily ladder): the delay scheduled after the n-th failed drain cycle is
 * `1 h × 4^(n−1)` — 1 h, 4 h, 16 h, 64 h, 256 h for n = 1..5. The early
 * rungs are dense because that is where recoveries actually happen (a
 * render-pending notice measured 2026-09-01 is fetchable within hours, not
 * days); the last rung keeps the ladder's total reach at ≈ 14 days so a
 * genuine multi-day upstream outage still gets the ADR-0010 §5.2 operator
 * a two-week decision window before rows abandon. The caller abandons at
 * `FETCH_RETRY_MAX_ATTEMPTS` and never schedules past it, which is what
 * bounds this function — it is deliberately not capped here, so the SQL in
 * `recordFetchRetryFailure` and this TS mirror stay one formula.
 * Exported so tests can assert the two agree.
 */
export function fetchRetryBackoffMs(attemptsAfterIncrement: number): number {
  if (!Number.isInteger(attemptsAfterIncrement) || attemptsAfterIncrement < 1) {
    throw new RangeError(
      `fetchRetryBackoffMs: attemptsAfterIncrement must be a positive integer, got ${String(attemptsAfterIncrement)}`,
    );
  }
  return HOUR_MS * 4 ** (attemptsAfterIncrement - 1);
}

export interface UpsertFetchRetryArgs {
  readonly source: string;
  readonly sourceNoticeId: string;
  readonly xmlUrl: string;
  /** `YYYY-MM-DD` notice publication date. */
  readonly publicationDate: string;
  /** Stable machine code from the fetch failure that caused this skip. */
  readonly errorCode: string;
  /** Epoch-millis the row becomes due for its first drain pass. */
  readonly nextAttemptAt: number;
  /** Defaults to now. */
  readonly now?: number;
}

/**
 * Idempotent insert-or-refresh keyed on `(source, source_notice_id)`
 * (ADR-0008 §3): the SAME notice being skipped again on a later day must
 * refresh `xml_url`/`last_error_code`/`updated_at` on the existing row, not
 * duplicate it — and must NEVER reset `attempts`, since that would erase the
 * row's backoff progress and effectively restart its retry budget for free.
 *
 * The `onConflictDoUpdate` `where: status = 'pending'` guard makes the
 * refresh a no-op against a `recovered`/`abandoned` row: a terminal outcome
 * for a notice must never be resurrected into `pending` by a later,
 * unrelated re-skip (SQLite UPSERT semantics — a false DO-UPDATE WHERE
 * leaves the conflicting row untouched and RETURNING yields nothing for it,
 * https://www.sqlite.org/lang_UPSERT.html). In that case this function
 * re-reads and returns the untouched row so callers always get the current
 * on-disk state back.
 */
export async function upsertFetchRetry(
  db: Db,
  args: UpsertFetchRetryArgs,
): Promise<IngestionFetchRetry> {
  assertIsoDate(args.publicationDate, 'publicationDate');
  const now = args.now ?? Date.now();
  const upserted = await db
    .insert(ingestionFetchRetries)
    .values({
      id: newId(now),
      source: args.source,
      sourceNoticeId: args.sourceNoticeId,
      xmlUrl: args.xmlUrl,
      publicationDate: args.publicationDate,
      attempts: 0,
      nextAttemptAt: args.nextAttemptAt,
      lastErrorCode: args.errorCode,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [ingestionFetchRetries.source, ingestionFetchRetries.sourceNoticeId],
      set: {
        xmlUrl: args.xmlUrl,
        lastErrorCode: args.errorCode,
        updatedAt: now,
      },
      where: eq(ingestionFetchRetries.status, 'pending'),
    })
    .returning();
  const row = upserted[0];
  if (row !== undefined) {
    return row;
  }
  // Conflict existed but the WHERE guard blocked the update (terminal row) —
  // return the row as it stands, unmodified.
  const existing = (
    await db
      .select()
      .from(ingestionFetchRetries)
      .where(
        and(
          eq(ingestionFetchRetries.source, args.source),
          eq(ingestionFetchRetries.sourceNoticeId, args.sourceNoticeId),
        ),
      )
      .limit(1)
  )[0];
  if (existing === undefined) {
    throw new Error('upsertFetchRetry: upsert returned no row and no existing row was found');
  }
  return existing;
}

export interface ListDueFetchRetriesArgs {
  /** Bounded batch size (the caller applies its own cap — `FETCH_RETRY_MAX_PER_RUN` in-run, `FETCH_RETRY_STANDALONE_MAX_PER_RUN` for the hourly drain). */
  readonly limit: number;
  /** Defaults to now. */
  readonly now?: number;
}

/**
 * The drain query (ADR-0008 §3): pending rows due for a retry, oldest first,
 * bounded by `limit`. Served exactly by
 * `idx_ingestion_fetch_retries__pending_next_attempt_at` — no in-memory
 * sort, no scan of terminal rows.
 */
export async function listDueFetchRetries(
  db: Db,
  args: ListDueFetchRetriesArgs,
): Promise<IngestionFetchRetry[]> {
  const now = args.now ?? Date.now();
  return db
    .select()
    .from(ingestionFetchRetries)
    .where(
      and(
        eq(ingestionFetchRetries.status, 'pending'),
        lte(ingestionFetchRetries.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(ingestionFetchRetries.nextAttemptAt), asc(ingestionFetchRetries.id))
    .limit(args.limit);
}

export interface MarkFetchRetryArgs {
  readonly id: string;
  /** Defaults to now. */
  readonly now?: number;
}

/**
 * Terminal transition `pending -> recovered`: the retried fetch succeeded
 * and the notice was persisted through the normal path. Guarded to
 * `status = 'pending'`, matching the one-way-transition invariant in this
 * module's header comment; a missing row or a row already in a terminal
 * state throws — a re-fired drain pass must never silently rewrite a
 * decided outcome.
 */
export async function markFetchRetryRecovered(
  db: Db,
  args: MarkFetchRetryArgs,
): Promise<IngestionFetchRetry> {
  const now = args.now ?? Date.now();
  const updated = await db
    .update(ingestionFetchRetries)
    .set({ status: 'recovered', updatedAt: now })
    .where(and(eq(ingestionFetchRetries.id, args.id), eq(ingestionFetchRetries.status, 'pending')))
    .returning();
  const row = updated[0];
  if (row === undefined) {
    throw new Error(
      `markFetchRetryRecovered: retry row ${args.id} is not in 'pending' status (missing or already terminal)`,
    );
  }
  return row;
}

/**
 * Terminal transition `pending -> abandoned`: `FETCH_RETRY_MAX_ATTEMPTS`
 * failed re-attempts have been exhausted (ADR-0008 §3 give-up). The caller
 * is responsible for the accompanying durable `NOTICE_FETCH_ABANDONED`
 * `ingestion_errors` row (`recordError`) — this function only moves the
 * retry row's own state. Same guard/throw contract as
 * `markFetchRetryRecovered`.
 */
export async function markFetchRetryAbandoned(
  db: Db,
  args: MarkFetchRetryArgs,
): Promise<IngestionFetchRetry> {
  const now = args.now ?? Date.now();
  const updated = await db
    .update(ingestionFetchRetries)
    .set({ status: 'abandoned', updatedAt: now })
    .where(and(eq(ingestionFetchRetries.id, args.id), eq(ingestionFetchRetries.status, 'pending')))
    .returning();
  const row = updated[0];
  if (row === undefined) {
    throw new Error(
      `markFetchRetryAbandoned: retry row ${args.id} is not in 'pending' status (missing or already terminal)`,
    );
  }
  return row;
}

/**
 * Total `pending` retry-row backlog (ADR-0008 §5 watchdog condition (ii):
 * pending retry backlog > 50 rows), regardless of whether each row is
 * currently due — the alert is about accumulating unrecovered notices, not
 * just today's drain queue. Served by the same partial pending index as
 * `listDueFetchRetries` (leading column differs but the partial predicate
 * matches, so this is still an index-only count, not a table scan).
 */
export async function countPendingFetchRetries(db: Db): Promise<number> {
  const row = (
    await db
      .select({ n: sql<number>`count(*)` })
      .from(ingestionFetchRetries)
      .where(eq(ingestionFetchRetries.status, 'pending'))
  )[0];
  return row?.n ?? 0;
}

export interface ListFetchRetriesArgs extends Pagination {
  /** Optional filter to one lifecycle state; omitted returns every status. */
  readonly status?: IngestionFetchRetryStatus;
}

/**
 * Admin read-only listing of `ingestion_fetch_retries` rows, newest first
 * (ADR-0008 §5 admin surface). `id` is a time-sortable ULID (`newId(now)`
 * used by `upsertFetchRetry`), so PK order is a stable single-column cursor.
 */
export async function listFetchRetries(
  db: Db,
  args: ListFetchRetriesArgs = {},
): Promise<Page<IngestionFetchRetry>> {
  const limit = normalizeLimit(args.limit);
  const rows = await db
    .select()
    .from(ingestionFetchRetries)
    .where(
      and(
        args.status === undefined ? undefined : eq(ingestionFetchRetries.status, args.status),
        args.cursor === undefined ? undefined : lt(ingestionFetchRetries.id, args.cursor),
      ),
    )
    .orderBy(desc(ingestionFetchRetries.id))
    .limit(limit + 1);
  return toPage(rows, limit, (row) => row.id);
}

/** Row counts per lifecycle state (ADR-0008 §5 admin surface — one indexed `GROUP BY`, not three separate counts). */
export async function countFetchRetriesByStatus(
  db: Db,
): Promise<Record<IngestionFetchRetryStatus, number>> {
  const rows = await db
    .select({ status: ingestionFetchRetries.status, n: sql<number>`count(*)` })
    .from(ingestionFetchRetries)
    .groupBy(ingestionFetchRetries.status);
  const counts: Record<IngestionFetchRetryStatus, number> = {
    pending: 0,
    recovered: 0,
    abandoned: 0,
  };
  for (const row of rows) {
    counts[row.status as IngestionFetchRetryStatus] = row.n;
  }
  return counts;
}

export interface RecordFetchRetryFailureArgs {
  readonly id: string;
  /** Stable machine code from this attempt's failure. */
  readonly errorCode: string;
  /** Defaults to now. */
  readonly now?: number;
}

/**
 * Records one failed re-attempt against a still-`pending` row: increments
 * `attempts`, then computes `next_attempt_at` from the INCREMENTED value
 * (ADR-0008 Amendment §A5 hourly-geometric backoff — `fetchRetryBackoffMs`
 * above, so the first failure, 0 -> 1, schedules the next attempt one hour
 * out, not immediately). The increment and the backoff computation happen
 * in ONE atomic UPDATE (SQL column expressions, not a read-then-write) so a
 * concurrent caller can never double-count an attempt. `1 << (2 × attempts)`
 * is `4^attempts` on the PRE-increment column value, i.e.
 * `4^(attempts_after_increment − 1)` — the same formula as the TS mirror.
 *
 * Guarded to `status = 'pending'` — a terminal row can never be re-failed.
 * The returned row's `attempts` IS the new count: the caller compares it to
 * `FETCH_RETRY_MAX_ATTEMPTS` and calls `markFetchRetryAbandoned` itself when
 * the budget is exhausted (this function never abandons on the caller's
 * behalf, keeping the give-up policy — and its accompanying
 * `NOTICE_FETCH_ABANDONED` diagnostic — entirely in the caller).
 */
export async function recordFetchRetryFailure(
  db: Db,
  args: RecordFetchRetryFailureArgs,
): Promise<IngestionFetchRetry> {
  const now = args.now ?? Date.now();
  const updated = await db
    .update(ingestionFetchRetries)
    .set({
      attempts: sql<number>`${ingestionFetchRetries.attempts} + 1`,
      nextAttemptAt: sql<number>`${now} + ${HOUR_MS} * (1 << (2 * ${ingestionFetchRetries.attempts}))`,
      lastErrorCode: args.errorCode,
      updatedAt: now,
    })
    .where(and(eq(ingestionFetchRetries.id, args.id), eq(ingestionFetchRetries.status, 'pending')))
    .returning();
  const row = updated[0];
  if (row === undefined) {
    throw new Error(
      `recordFetchRetryFailure: retry row ${args.id} is not in 'pending' status (missing or already terminal)`,
    );
  }
  return row;
}

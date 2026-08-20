/**
 * Ingestion pipeline ops tables (docs/data-model.md §5) — GLOBAL tables (no
 * organization_id): operational metadata for the shared tender corpus
 * pipeline, never customer data.
 *
 * Conventions (docs/data-model.md): TEXT ULID ids generated in the
 * application, INTEGER epoch-millis `*_at` timestamps (`created_at` on every
 * table, `updated_at` only on mutable tables), TEXT `YYYY-MM-DD` `*_date`
 * calendar dates, TEXT+CHECK enums, `_json` TEXT columns. No ON DELETE
 * CASCADE — deletes are explicit application-level operations
 * (docs/data-model.md §11 Retention & archival).
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * One row per scheduled/triggered ingestion execution; the admin debugging
 * anchor. Mutable: counters, `status` and `finished_at` move while the run
 * executes.
 */
export const ingestionRuns = sqliteTable(
  'ingestion_runs',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    /** Lifecycle state of the run. */
    status: text('status').notNull(),
    /** `YYYY-MM-DD` start of the publication window processed. */
    windowFrom: text('window_from').notNull(),
    /** `YYYY-MM-DD` end of the publication window processed. */
    windowTo: text('window_to').notNull(),
    noticesSeen: integer('notices_seen').notNull().default(0),
    noticesUpserted: integer('notices_upserted').notNull().default(0),
    versionsCreated: integer('versions_created').notNull().default(0),
    lotsCreated: integer('lots_created').notNull().default(0),
    /** Scoring runs inside the ingestion pipeline. */
    matchesScored: integer('matches_scored').notNull().default(0),
    errorsCount: integer('errors_count').notNull().default(0),
    /**
     * Per-notice XML fetch failures recorded as record-and-continue skips
     * (ADR-0008 §1/§5) — distinct from `errorsCount`, which also counts
     * parse/map/persist failures. Lets watchdog/admin distinguish "healthy
     * partial" from "systemically degraded" with one indexed read instead of
     * grouping `ingestion_errors` by code prefix on every check.
     */
    noticesFetchFailed: integer('notices_fetch_failed').notNull().default(0),
    /**
     * Per-notice render-pending exhaustions recorded as record-and-continue
     * skips (ADR-0009 §1) — distinct from `noticesFetchFailed`: the origin
     * is cooperating (202/empty-body, render queued but slow), not
     * refusing. Split out so it never counts toward the §2 systemic
     * fetch-failure threshold, and so watchdog/admin can distinguish a
     * slow-render day from a genuinely degraded one with one indexed read.
     */
    noticesRenderPending: integer('notices_render_pending').notNull().default(0),
    startedAt: integer('started_at').notNull(),
    /** Null while the run is still executing. */
    finishedAt: integer('finished_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_ingestion_runs__source_started_at').on(t.source, t.startedAt),
    check(
      'ck_ingestion_runs__status',
      sql`${t.status} IN ('running', 'succeeded', 'partial', 'failed')`,
    ),
  ],
);

/**
 * Per-source incremental cursor: the last fully processed publication
 * window/sequence. Exactly one row per source (unique `source`). Mutable —
 * advanced after each successfully processed window.
 */
export const ingestionCheckpoints = sqliteTable(
  'ingestion_checkpoints',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    /** `YYYY-MM-DD` last fully-processed publication window. */
    lastPublicationDate: text('last_publication_date').notNull(),
    /** Source-specific pagination/sequence token within the window. */
    lastSequenceToken: text('last_sequence_token'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_ingestion_checkpoints__source').on(t.source)],
);

/**
 * Row-level failures that did not abort the run (a bad notice must never
 * stop the batch). Append-only, immutable.
 */
export const ingestionErrors = sqliteTable(
  'ingestion_errors',
  {
    id: text('id').primaryKey(),
    ingestionRunId: text('ingestion_run_id')
      .notNull()
      .references(() => ingestionRuns.id),
    source: text('source').notNull(),
    /** Null for window-level errors not tied to a single notice. */
    sourceNoticeId: text('source_notice_id'),
    /** Pipeline stage that failed. */
    stage: text('stage').notNull(),
    /** Stable machine code, e.g. `MISSING_CPV`. */
    errorCode: text('error_code').notNull(),
    message: text('message').notNull(),
    /** Offending fragment / structured context. */
    detailJson: text('detail_json'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_ingestion_errors__ingestion_run_id').on(t.ingestionRunId),
    index('idx_ingestion_errors__source_source_notice_id').on(t.source, t.sourceNoticeId),
    check(
      'ck_ingestion_errors__stage',
      sql`${t.stage} IN ('fetch', 'parse', 'map', 'persist', 'score')`,
    ),
  ],
);

/**
 * Bounded per-notice retry queue for XML fetch failures that would
 * otherwise be lost past the checkpoint (ADR-0008 §3 "poison pill" fix). A
 * row is inserted, idempotently on `(source, source_notice_id)`, when
 * `processOneNotice` skips a notice after `TedRequestError`; the daily
 * ingestion cron drains due rows through the identical fetch/parse/persist
 * path. Mutable: `attempts`/`next_attempt_at`/`last_error_code`/`status`
 * move as the row is retried, recovered, or abandoned.
 */
export const ingestionFetchRetries = sqliteTable(
  'ingestion_fetch_retries',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    sourceNoticeId: text('source_notice_id').notNull(),
    /** Notice XML URL to re-fetch, as returned by the last search page. */
    xmlUrl: text('xml_url').notNull(),
    /** `YYYY-MM-DD` notice publication date. */
    publicationDate: text('publication_date').notNull(),
    /** Failed re-attempts so far (0 = never yet retried since insert). */
    attempts: integer('attempts').notNull().default(0),
    /** Epoch-millis the row becomes due for the next drain pass. */
    nextAttemptAt: integer('next_attempt_at').notNull(),
    /** Stable machine code from the most recent failure (PR #46 codes). */
    lastErrorCode: text('last_error_code').notNull(),
    /** Lifecycle state; terminal once `recovered` or `abandoned`. */
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    // Idempotency key: re-skipping the same notice on a later day must
    // refresh the existing row (repositories/ingestion.ts
    // `upsertFetchRetry`), never duplicate it.
    uniqueIndex('uq_ingestion_fetch_retries__source_source_notice_id').on(
      t.source,
      t.sourceNoticeId,
    ),
    // Serves the drain query exactly (ADR-0008 §3): `WHERE status =
    // 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at ASC, id
    // ASC LIMIT FETCH_RETRY_MAX_PER_RUN`. Partial (`WHERE status =
    // 'pending'`) so the index never carries `recovered`/`abandoned` rows —
    // those are never queried by this path and would only bloat the index
    // as terminal rows accumulate before retention purges them. Leading
    // column `next_attempt_at` matches the ORDER BY directly (no in-memory
    // sort); trailing `id` breaks ties deterministically in creation order
    // (ULIDs are time-sortable) without needing a second `created_at`
    // column in the index.
    index('idx_ingestion_fetch_retries__pending_next_attempt_at')
      .on(t.nextAttemptAt, t.id)
      .where(sql`${t.status} = 'pending'`),
    check(
      'ck_ingestion_fetch_retries__status',
      sql`${t.status} IN ('pending', 'recovered', 'abandoned')`,
    ),
  ],
);

/**
 * Pointer to the raw source payload archived in R2 (ADR-0005): the DB stores
 * metadata only; XML bodies never enter D1. Mutable: the retention job sets
 * `retained_until_at` / `deleted_at` (tombstone kept for audit after the R2
 * object is deleted).
 */
export const sourceSnapshots = sqliteTable(
  'source_snapshots',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    sourceNoticeId: text('source_notice_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    /**
     * Deterministic R2 path:
     * `{source}/{yyyy}/{mm}/{source_notice_id}/v{version_number}.xml`.
     */
    r2Key: text('r2_key').notNull(),
    /** Integrity + change detection. */
    contentHash: text('content_hash').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    contentType: text('content_type').notNull(),
    /** Retention hint for the R2 lifecycle job. */
    retainedUntilAt: integer('retained_until_at'),
    /** Tombstone after R2 object deletion (row kept for audit). */
    deletedAt: integer('deleted_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_source_snapshots__r2_key').on(t.r2Key),
    index('idx_source_snapshots__source_source_notice_id').on(t.source, t.sourceNoticeId),
  ],
);

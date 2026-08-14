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
 * - snapshot rows are inserted only for genuinely new content hashes.
 */
import { and, desc, eq, isNull, lt } from 'drizzle-orm';

import type { Db } from '../client';
import { newId } from '../id';
import {
  ingestionCheckpoints,
  ingestionErrors,
  ingestionRuns,
  sourceSnapshots,
} from '../schema/ingestion';
import { assertIsoDate, normalizeLimit, toPage } from './shared';
import type { Page, Pagination } from './shared';

export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type IngestionCheckpoint = typeof ingestionCheckpoints.$inferSelect;
export type IngestionError = typeof ingestionErrors.$inferSelect;
export type SourceSnapshot = typeof sourceSnapshots.$inferSelect;

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

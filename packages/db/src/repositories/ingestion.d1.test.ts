/**
 * Ingestion-ops repository integration tests against real D1 (workerd):
 * run lifecycle transitions, the checkpoint advance-only rule, and the
 * append-only error ledger (docs/data-model.md §5).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import { MS_PER_DAY, T0, testDb } from '../test/helpers';
import {
  advanceCheckpoint,
  createRun,
  fetchRetryBackoffMs,
  finishRun,
  getCheckpoint,
  hasActiveIngestionRun,
  listDueFetchRetries,
  markFetchRetryAbandoned,
  markFetchRetryRecovered,
  recordError,
  recordFetchRetryFailure,
  upsertFetchRetry,
} from './ingestion';

const SOURCE = 'ted';
const MS_PER_HOUR = 3_600_000;

const COUNTS = {
  noticesSeen: 120,
  noticesUpserted: 118,
  versionsCreated: 5,
  lotsCreated: 240,
  matchesScored: 96,
  errorsCount: 2,
  noticesFetchFailed: 1,
  noticesRenderPending: 3,
} as const;

describe('ingestion runs', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('creates a run in running status and finishes it exactly once', async () => {
    const run = await createRun(db, {
      source: SOURCE,
      windowFrom: '2026-08-01',
      windowTo: '2026-08-01',
      startedAt: T0,
    });
    expect(run.status).toBe('running');
    expect(run.startedAt).toBe(T0);
    expect(run.finishedAt).toBeNull();

    const finished = await finishRun(db, {
      runId: run.id,
      status: 'succeeded',
      counts: COUNTS,
      finishedAt: T0 + 60_000,
    });
    expect(finished).toMatchObject({
      id: run.id,
      status: 'succeeded',
      finishedAt: T0 + 60_000,
      ...COUNTS,
    });
    // Explicit round-trip on the ADR-0008 §5 column, not just the spread above.
    expect(finished.noticesFetchFailed).toBe(1);
    // Explicit round-trip on the ADR-0009 §1 column, not just the spread above.
    expect(finished.noticesRenderPending).toBe(3);
  });

  it('defaults notices_fetch_failed to 0 when the caller omits it (backward-compatible finishRun)', async () => {
    const run = await createRun(db, {
      source: SOURCE,
      windowFrom: '2026-08-01',
      windowTo: '2026-08-01',
      startedAt: T0,
    });
    const { noticesFetchFailed, ...countsWithoutFetchFailed } = COUNTS;
    void noticesFetchFailed;

    const finished = await finishRun(db, {
      runId: run.id,
      status: 'succeeded',
      counts: countsWithoutFetchFailed,
      finishedAt: T0 + 1,
    });
    expect(finished.noticesFetchFailed).toBe(0);
  });

  it('defaults notices_render_pending to 0 when the caller omits it (backward-compatible finishRun, ADR-0009 §1)', async () => {
    const run = await createRun(db, {
      source: SOURCE,
      windowFrom: '2026-08-01',
      windowTo: '2026-08-01',
      startedAt: T0,
    });
    const { noticesRenderPending, ...countsWithoutRenderPending } = COUNTS;
    void noticesRenderPending;

    const finished = await finishRun(db, {
      runId: run.id,
      status: 'succeeded',
      counts: countsWithoutRenderPending,
      finishedAt: T0 + 1,
    });
    expect(finished.noticesRenderPending).toBe(0);
  });

  it('rejects the invalid transition of finishing an already-finished run', async () => {
    const run = await createRun(db, {
      source: SOURCE,
      windowFrom: '2026-08-01',
      windowTo: '2026-08-01',
      startedAt: T0,
    });
    await finishRun(db, { runId: run.id, status: 'partial', counts: COUNTS, finishedAt: T0 + 1 });

    // partial -> failed is not a legal transition: only running -> terminal.
    await expect(
      finishRun(db, { runId: run.id, status: 'failed', counts: COUNTS, finishedAt: T0 + 2 }),
    ).rejects.toThrow(/not in 'running' status/);
  });

  it('rejects finishing a run that does not exist', async () => {
    await expect(
      finishRun(db, {
        runId: '01K1LZZZZZZZZZZZZZZZZZZZZZ',
        status: 'succeeded',
        counts: COUNTS,
        finishedAt: T0,
      }),
    ).rejects.toThrow(/not in 'running' status/);
  });
});

describe('ingestion checkpoints', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  // Checkpoints are unique per source and the test file shares one database
  // (per-FILE isolation), so each test works on its own source string.
  it('creates, then advances forward, and allows a same-date sequence-token move', async () => {
    const source = 'ted-checkpoint-advance';
    expect(await getCheckpoint(db, { source })).toBeNull();

    const created = await advanceCheckpoint(db, {
      source,
      lastPublicationDate: '2026-08-01',
      lastSequenceToken: 'page-3',
    });
    expect(created).toMatchObject({
      lastPublicationDate: '2026-08-01',
      lastSequenceToken: 'page-3',
    });

    const advanced = await advanceCheckpoint(db, {
      source,
      lastPublicationDate: '2026-08-02',
      lastSequenceToken: null,
    });
    expect(advanced).toMatchObject({
      id: created.id,
      lastPublicationDate: '2026-08-02',
      lastSequenceToken: null,
    });

    const tokenMove = await advanceCheckpoint(db, {
      source,
      lastPublicationDate: '2026-08-02',
      lastSequenceToken: 'page-7',
    });
    expect(tokenMove).toMatchObject({
      id: created.id,
      lastPublicationDate: '2026-08-02',
      lastSequenceToken: 'page-7',
    });
  });

  it('never moves backwards: an earlier date throws and the stored row is unchanged', async () => {
    const source = 'ted-checkpoint-backwards';
    await advanceCheckpoint(db, {
      source,
      lastPublicationDate: '2026-08-02',
      lastSequenceToken: 'page-7',
    });

    await expect(
      advanceCheckpoint(db, { source, lastPublicationDate: '2026-08-01' }),
    ).rejects.toThrow(/backwards/);

    const checkpoint = await getCheckpoint(db, { source });
    expect(checkpoint).toMatchObject({
      lastPublicationDate: '2026-08-02',
      lastSequenceToken: 'page-7',
    });
  });
});

describe('recordError', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('appends a reproducible row-level error tied to its run and snapshot', async () => {
    const run = await createRun(db, {
      source: SOURCE,
      windowFrom: '2026-08-01',
      windowTo: '2026-08-01',
      startedAt: T0,
    });

    const error = await recordError(db, {
      ingestionRunId: run.id,
      source: SOURCE,
      sourceNoticeId: '00123456-2026',
      stage: 'map',
      errorCode: 'MISSING_CPV',
      message: 'Lot LOT-0001 has no CPV classification',
      snapshotR2Key: 'ted/2026/08/00123456-2026/v1.xml',
      detail: { lotNumber: 'LOT-0001' },
    });

    expect(error).toMatchObject({
      ingestionRunId: run.id,
      source: SOURCE,
      sourceNoticeId: '00123456-2026',
      stage: 'map',
      errorCode: 'MISSING_CPV',
      message: 'Lot LOT-0001 has no CPV classification',
    });
    expect(JSON.parse(error.detailJson ?? '{}')).toEqual({
      lotNumber: 'LOT-0001',
      snapshotR2Key: 'ted/2026/08/00123456-2026/v1.xml',
    });

    // Window-level error without a notice or snapshot reference.
    const windowError = await recordError(db, {
      ingestionRunId: run.id,
      source: SOURCE,
      stage: 'fetch',
      errorCode: 'SOURCE_TIMEOUT',
      message: 'TED search API timed out',
    });
    expect(windowError.sourceNoticeId).toBeNull();
    expect(windowError.detailJson).toBeNull();
  });
});

describe('ingestion fetch retries (ADR-0008 §3)', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('upserts idempotently on (source, source_notice_id) and never resets attempts on refresh', async () => {
    const sourceNoticeId = 'retry-idempotent-001';
    const created = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId,
      xmlUrl: 'https://ted.europa.eu/notice/v1.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0,
    });
    expect(created).toMatchObject({
      source: SOURCE,
      sourceNoticeId,
      xmlUrl: 'https://ted.europa.eu/notice/v1.xml',
      attempts: 0,
      nextAttemptAt: T0,
      lastErrorCode: 'NOTICE_FETCH_HTTP_503',
      status: 'pending',
    });

    // Simulate one failed drain attempt so attempts > 0 before the refresh.
    const afterFailure = await recordFetchRetryFailure(db, {
      id: created.id,
      errorCode: 'NOTICE_FETCH_NETWORK_ERROR',
      now: T0 + MS_PER_DAY,
    });
    expect(afterFailure.attempts).toBe(1);

    // A later re-skip of the SAME notice: new xml_url + error code, an
    // unrelated caller-supplied nextAttemptAt (ignored on refresh).
    const refreshed = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId,
      xmlUrl: 'https://ted.europa.eu/notice/v2.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_500',
      nextAttemptAt: T0 + 999_000_000,
      now: T0 + 2 * MS_PER_DAY,
    });
    expect(refreshed.id).toBe(created.id);
    expect(refreshed.xmlUrl).toBe('https://ted.europa.eu/notice/v2.xml');
    expect(refreshed.lastErrorCode).toBe('NOTICE_FETCH_HTTP_500');
    expect(refreshed.updatedAt).toBe(T0 + 2 * MS_PER_DAY);
    // attempts and next_attempt_at are untouched by the refresh.
    expect(refreshed.attempts).toBe(1);
    expect(refreshed.nextAttemptAt).toBe(afterFailure.nextAttemptAt);
  });

  it('refreshing a terminal (recovered) row is a no-op: status/attempts stay as decided', async () => {
    const sourceNoticeId = 'retry-terminal-refresh-001';
    const created = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId,
      xmlUrl: 'https://ted.europa.eu/notice/v1.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0,
    });
    const recovered = await markFetchRetryRecovered(db, { id: created.id, now: T0 + MS_PER_DAY });
    expect(recovered.status).toBe('recovered');

    const reSkipped = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId,
      xmlUrl: 'https://ted.europa.eu/notice/v2.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_NETWORK_ERROR',
      nextAttemptAt: T0 + 2 * MS_PER_DAY,
      now: T0 + 3 * MS_PER_DAY,
    });
    expect(reSkipped.id).toBe(created.id);
    expect(reSkipped.status).toBe('recovered');
    // Untouched: the terminal row's xml_url/error/updated_at do not move.
    expect(reSkipped.xmlUrl).toBe('https://ted.europa.eu/notice/v1.xml');
    expect(reSkipped.lastErrorCode).toBe('NOTICE_FETCH_HTTP_503');
    expect(reSkipped.updatedAt).toBe(T0 + MS_PER_DAY);
  });

  it('due-listing: excludes not-yet-due and terminal rows, orders oldest-first, respects limit', async () => {
    const oldest = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId: 'retry-due-oldest',
      xmlUrl: 'https://ted.europa.eu/notice/oldest.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0 - 3_000,
    });
    const middle = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId: 'retry-due-middle',
      xmlUrl: 'https://ted.europa.eu/notice/middle.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0 - 2_000,
    });
    const notYetDue = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId: 'retry-due-future',
      xmlUrl: 'https://ted.europa.eu/notice/future.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0 + 1_000_000,
    });
    const terminalButOverdue = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId: 'retry-due-terminal',
      xmlUrl: 'https://ted.europa.eu/notice/terminal.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0 - 5_000,
    });
    await markFetchRetryAbandoned(db, { id: terminalButOverdue.id, now: T0 });

    const due = await listDueFetchRetries(db, { limit: 10, now: T0 });
    expect(due.map((r) => r.id)).toEqual([oldest.id, middle.id]);
    expect(due.map((r) => r.id)).not.toContain(notYetDue.id);
    expect(due.map((r) => r.id)).not.toContain(terminalButOverdue.id);

    const limited = await listDueFetchRetries(db, { limit: 1, now: T0 });
    expect(limited.map((r) => r.id)).toEqual([oldest.id]);
  });

  it('records failure backoff arithmetic: attempts increments, next_attempt_at computed AFTER the increment', async () => {
    const created = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId: 'retry-backoff-001',
      xmlUrl: 'https://ted.europa.eu/notice/v1.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0,
    });
    expect(created.attempts).toBe(0);

    // ADR-0008 Amendment §A5: hourly-geometric ladder. 0 -> 1 schedules one
    // hour out (not a day, not immediately).
    const firstFailure = await recordFetchRetryFailure(db, {
      id: created.id,
      errorCode: 'NOTICE_FETCH_HTTP_503',
      now: T0,
    });
    expect(firstFailure.attempts).toBe(1);
    expect(firstFailure.nextAttemptAt).toBe(T0 + MS_PER_HOUR);

    // 1 -> 2 schedules four hours out from THIS failure's `now`, proving the
    // exponent is taken from the incremented value and the base from `now`.
    const secondFailure = await recordFetchRetryFailure(db, {
      id: created.id,
      errorCode: 'NOTICE_FETCH_NETWORK_ERROR',
      now: T0 + MS_PER_DAY,
    });
    expect(secondFailure.attempts).toBe(2);
    expect(secondFailure.nextAttemptAt).toBe(T0 + MS_PER_DAY + 4 * MS_PER_HOUR);
    expect(secondFailure.lastErrorCode).toBe('NOTICE_FETCH_NETWORK_ERROR');
  });

  it('ADR-0008 §A5 ladder: the SQL in recordFetchRetryFailure and the exported TS mirror agree rung for rung (1h, 4h, 16h, 64h, 256h)', async () => {
    const created = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId: 'retry-ladder-001',
      xmlUrl: 'https://ted.europa.eu/notice/v1.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0,
    });
    // The literal hours are the contract the ADR states; the TS helper is
    // what tests and callers reason with; the SQL is what production runs.
    // All three must be one formula, so all three are asserted together.
    const expectedHours = [1, 4, 16, 64, 256];
    for (const [index, hours] of expectedHours.entries()) {
      const attemptsAfter = index + 1;
      const failed = await recordFetchRetryFailure(db, {
        id: created.id,
        errorCode: 'NOTICE_RENDER_PENDING',
        now: T0,
      });
      expect(failed.attempts).toBe(attemptsAfter);
      expect(failed.nextAttemptAt - T0).toBe(hours * MS_PER_HOUR);
      expect(fetchRetryBackoffMs(attemptsAfter)).toBe(hours * MS_PER_HOUR);
    }
  });

  it('fetchRetryBackoffMs rejects a non-positive or fractional attempt count', () => {
    expect(() => fetchRetryBackoffMs(0)).toThrow(RangeError);
    expect(() => fetchRetryBackoffMs(-1)).toThrow(RangeError);
    expect(() => fetchRetryBackoffMs(1.5)).toThrow(RangeError);
  });

  it('recordFetchRetryFailure throws for a missing or already-terminal row', async () => {
    await expect(
      recordFetchRetryFailure(db, {
        id: '01K1LZZZZZZZZZZZZZZZZZZZZZ',
        errorCode: 'NOTICE_FETCH_HTTP_503',
        now: T0,
      }),
    ).rejects.toThrow(/not in 'pending' status/);

    const created = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId: 'retry-terminal-failure-001',
      xmlUrl: 'https://ted.europa.eu/notice/v1.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0,
    });
    await markFetchRetryRecovered(db, { id: created.id, now: T0 });

    await expect(
      recordFetchRetryFailure(db, { id: created.id, errorCode: 'NOTICE_FETCH_HTTP_503', now: T0 }),
    ).rejects.toThrow(/not in 'pending' status/);
  });

  it('recovered and abandoned are terminal: never re-transitionable, never listed as due again', async () => {
    const recoveredRow = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId: 'retry-terminal-recovered-001',
      xmlUrl: 'https://ted.europa.eu/notice/v1.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0 - 1_000,
    });
    const recovered = await markFetchRetryRecovered(db, { id: recoveredRow.id, now: T0 });
    expect(recovered.status).toBe('recovered');
    await expect(markFetchRetryRecovered(db, { id: recoveredRow.id, now: T0 })).rejects.toThrow(
      /not in 'pending' status/,
    );
    await expect(markFetchRetryAbandoned(db, { id: recoveredRow.id, now: T0 })).rejects.toThrow(
      /not in 'pending' status/,
    );

    const abandonedRow = await upsertFetchRetry(db, {
      source: SOURCE,
      sourceNoticeId: 'retry-terminal-abandoned-001',
      xmlUrl: 'https://ted.europa.eu/notice/v1.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_503',
      nextAttemptAt: T0 - 1_000,
    });
    const abandoned = await markFetchRetryAbandoned(db, { id: abandonedRow.id, now: T0 });
    expect(abandoned.status).toBe('abandoned');
    await expect(markFetchRetryAbandoned(db, { id: abandonedRow.id, now: T0 })).rejects.toThrow(
      /not in 'pending' status/,
    );

    const due = await listDueFetchRetries(db, { limit: 10, now: T0 });
    expect(due.map((r) => r.id)).not.toContain(recoveredRow.id);
    expect(due.map((r) => r.id)).not.toContain(abandonedRow.id);
  });
});

describe('hasActiveIngestionRun (ADR-0008 §A5 standalone-drain guard)', () => {
  // Own source string: this file shares one D1, and the run-lifecycle tests
  // above leave `running` rows for SOURCE behind by design.
  const GUARD_SOURCE = 'ted-active-run-guard';
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('is true for a running run started inside the horizon, false once it finishes', async () => {
    const run = await createRun(db, {
      source: GUARD_SOURCE,
      windowFrom: '2026-08-01',
      windowTo: '2026-08-01',
      startedAt: T0,
    });
    expect(await hasActiveIngestionRun(db, { source: GUARD_SOURCE, sinceMs: T0 - 1 })).toBe(true);
    expect(await hasActiveIngestionRun(db, { source: GUARD_SOURCE, sinceMs: T0 })).toBe(true);

    await finishRun(db, { runId: run.id, status: 'succeeded', counts: COUNTS, finishedAt: T0 + 1 });
    expect(await hasActiveIngestionRun(db, { source: GUARD_SOURCE, sinceMs: T0 - 1 })).toBe(false);
  });

  it('ignores an orphaned running run older than the horizon — a crashed consumer must not block the drain forever', async () => {
    const orphan = await createRun(db, {
      source: GUARD_SOURCE,
      windowFrom: '2026-08-02',
      windowTo: '2026-08-02',
      startedAt: T0 - 16 * 60_000,
    });
    // Never finished, on purpose.
    expect(
      await hasActiveIngestionRun(db, { source: GUARD_SOURCE, sinceMs: T0 - 15 * 60_000 }),
    ).toBe(false);
    // The same row IS live under a wider horizon — the query is horizon-bound, not status-bound.
    expect(
      await hasActiveIngestionRun(db, { source: GUARD_SOURCE, sinceMs: T0 - 17 * 60_000 }),
    ).toBe(true);
    expect(orphan.status).toBe('running');
  });

  it('is scoped by source', async () => {
    await createRun(db, {
      source: `${GUARD_SOURCE}-other`,
      windowFrom: '2026-08-03',
      windowTo: '2026-08-03',
      startedAt: T0,
    });
    expect(
      await hasActiveIngestionRun(db, { source: `${GUARD_SOURCE}-none`, sinceMs: T0 - 1 }),
    ).toBe(false);
  });
});

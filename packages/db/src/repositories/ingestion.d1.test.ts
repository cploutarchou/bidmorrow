/**
 * Ingestion-ops repository integration tests against real D1 (workerd):
 * run lifecycle transitions, the checkpoint advance-only rule, and the
 * append-only error ledger (docs/data-model.md §5).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import { T0, testDb } from '../test/helpers';
import { advanceCheckpoint, createRun, finishRun, getCheckpoint, recordError } from './ingestion';

const SOURCE = 'ted';

const COUNTS = {
  noticesSeen: 120,
  noticesUpserted: 118,
  versionsCreated: 5,
  lotsCreated: 240,
  matchesScored: 96,
  errorsCount: 2,
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

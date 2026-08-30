/**
 * Dead-letter recording against real D1 (workerd) — F-07.
 *
 * The properties that matter: recording is idempotent under at-least-once
 * DLQ redelivery, redelivery never resurrects work an operator already
 * closed, and "depth" means outstanding rather than all-time.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import { deadLetterMessages } from '../schema/ingestion';
import { testDb } from '../test/helpers';
import {
  getDeadLetterDepth,
  listDeadLetters,
  recordDeadLetter,
  resolveDeadLetter,
} from './dead-letters';

const T0 = Date.parse('2026-08-29T12:00:00Z');

describe('dead-letter messages', () => {
  let db: Db;

  beforeEach(async () => {
    db = testDb();
    // `testDb()` hands back the SAME local D1 across tests in this file, and
    // dead_letter_messages is a global table with no organization to scope
    // assertions by — so clear it, or each test inherits the previous one's
    // rows and the depth assertions become meaningless.
    await db.delete(deadLetterMessages);
  });

  async function record(overrides: Partial<Parameters<typeof recordDeadLetter>[1]> = {}) {
    await recordDeadLetter(db, {
      queue: 'bidmorrow-ingest-dlq-local',
      providerMessageId: 'msg-1',
      bodyJson: JSON.stringify({ kind: 'ingest' }),
      attempts: 3,
      deadLetteredAt: T0,
      ...overrides,
    });
  }

  it('records a dead-lettered message and counts it as depth', async () => {
    await record();

    const depth = await getDeadLetterDepth(db);
    expect(depth.unresolved).toBe(1);
    expect(depth.byQueue).toEqual([{ queue: 'bidmorrow-ingest-dlq-local', count: 1 }]);
    expect(depth.lastDeadLetteredAt).toBe(T0);
  });

  it('is idempotent — an at-least-once redelivery does not double-count', async () => {
    await record();
    await record();
    await record();

    expect((await getDeadLetterDepth(db)).unresolved).toBe(1);
    expect(await listDeadLetters(db)).toHaveLength(1);
  });

  it('a redelivery never resurrects a row the operator already resolved', async () => {
    await record();
    const [row] = await listDeadLetters(db);
    expect(await resolveDeadLetter(db, row?.id ?? '')).toBe(true);
    expect((await getDeadLetterDepth(db)).unresolved).toBe(0);

    // Cloudflare redelivers the same message id after the operator closed it.
    await record();

    // Still resolved: an upsert here would silently reopen closed work.
    expect((await getDeadLetterDepth(db)).unresolved).toBe(0);
  });

  it('depth counts outstanding work, not all-time history', async () => {
    await record({ providerMessageId: 'msg-a' });
    await record({ providerMessageId: 'msg-b', queue: 'bidmorrow-digest-dlq-local' });
    expect((await getDeadLetterDepth(db)).unresolved).toBe(2);

    const rows = await listDeadLetters(db);
    await resolveDeadLetter(db, rows[0]?.id ?? '');

    const depth = await getDeadLetterDepth(db);
    expect(depth.unresolved).toBe(1);
    // History survives even though depth dropped.
    expect(await listDeadLetters(db)).toHaveLength(2);
    expect(await listDeadLetters(db, { unresolvedOnly: true })).toHaveLength(1);
  });

  it('resolving is not repeatable — the second call reports no state change', async () => {
    await record();
    const [row] = await listDeadLetters(db);
    expect(await resolveDeadLetter(db, row?.id ?? '')).toBe(true);
    expect(await resolveDeadLetter(db, row?.id ?? '')).toBe(false);
  });

  it('resolving an unknown id reports no state change rather than throwing', async () => {
    expect(await resolveDeadLetter(db, 'does-not-exist')).toBe(false);
  });

  it('reports zero depth and no last-dead-letter on a clean database', async () => {
    const depth = await getDeadLetterDepth(db);
    expect(depth.unresolved).toBe(0);
    expect(depth.byQueue).toEqual([]);
    expect(depth.lastDeadLetteredAt).toBeNull();
  });

  it('keeps the payload verbatim for diagnosis and replay', async () => {
    const body = JSON.stringify({
      kind: 'digest',
      organizationId: 'org_1',
      localDate: '2026-08-29',
    });
    await record({ bodyJson: body });

    const [row] = await listDeadLetters(db);
    expect(row?.bodyJson).toBe(body);
    expect(row?.attempts).toBe(3);
  });
});

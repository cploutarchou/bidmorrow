/**
 * digest_runs integration tests against real D1 (workerd): the unique
 * `(organization_id, digest_date)` is the DB-enforced daily dedupe
 * mechanism (docs/data-model.md §8) — these tests prove the constraint
 * itself fires, not just the repository's error mapping.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import { newId } from '../id';
import { digestRuns } from '../schema/engagement';
import { T0, insertTestOrganization, testDb } from '../test/helpers';
import { DuplicateDigestError } from './errors';
import { createDigestRun } from './engagement';

/**
 * Asserts a write was rejected by SQLite's UNIQUE constraint. Drizzle wraps
 * driver failures (`Failed query: …` with the D1 error as `cause`), so the
 * whole cause chain is searched for the constraint message.
 */
async function expectUniqueConstraintViolation(write: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await write;
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected the insert to be rejected').toBeInstanceOf(Error);
  const messages: string[] = [];
  for (let error = caught; error instanceof Error; error = error.cause) {
    messages.push(error.message);
  }
  expect(messages.join(' | ')).toMatch(/UNIQUE constraint failed/);
}

describe('createDigestRun', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('claims the day and surfaces a second claim as DuplicateDigestError', async () => {
    const { orgId } = await insertTestOrganization(db);

    const run = await createDigestRun(db, orgId, { digestDate: '2026-08-01', matchesCount: 4 });
    expect(run).toMatchObject({
      organizationId: orgId,
      digestDate: '2026-08-01',
      status: 'pending',
      matchesCount: 4,
    });

    await expect(createDigestRun(db, orgId, { digestDate: '2026-08-01' })).rejects.toThrow(
      DuplicateDigestError,
    );
    await expect(createDigestRun(db, orgId, { digestDate: '2026-08-01' })).rejects.toMatchObject({
      code: 'DUPLICATE_DIGEST',
      organizationId: orgId,
      digestDate: '2026-08-01',
    });

    // The winning row is untouched by the losing attempts.
    const rows = await db.select().from(digestRuns).where(eq(digestRuns.organizationId, orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(run.id);
  });

  it('is enforced by the DB unique constraint, not app logic: a raw duplicate insert fails', async () => {
    const { orgId } = await insertTestOrganization(db);
    await createDigestRun(db, orgId, { digestDate: '2026-08-01' });

    // Bypass the repository entirely: a direct insert with a fresh id but the
    // same (organization_id, digest_date) must be rejected by SQLite itself.
    await expectUniqueConstraintViolation(
      db.insert(digestRuns).values({
        id: newId(T0),
        organizationId: orgId,
        digestDate: '2026-08-01',
        status: 'pending',
        matchesCount: 0,
        emailDeliveryId: null,
        sentAt: null,
        createdAt: T0,
        updatedAt: T0,
      }),
    );
  });

  it('allows the same date for a different organization and a different date for the same one', async () => {
    const first = await insertTestOrganization(db, 'Org One');
    const second = await insertTestOrganization(db, 'Org Two');

    await createDigestRun(db, first.orgId, { digestDate: '2026-08-01' });
    const otherOrg = await createDigestRun(db, second.orgId, { digestDate: '2026-08-01' });
    const nextDay = await createDigestRun(db, first.orgId, { digestDate: '2026-08-02' });

    expect(otherOrg.organizationId).toBe(second.orgId);
    expect(nextDay.digestDate).toBe('2026-08-02');
    const firstRows = await db
      .select()
      .from(digestRuns)
      .where(eq(digestRuns.organizationId, first.orgId));
    const secondRows = await db
      .select()
      .from(digestRuns)
      .where(eq(digestRuns.organizationId, second.orgId));
    expect(firstRows.map((row) => row.digestDate).sort()).toEqual(['2026-08-01', '2026-08-02']);
    expect(secondRows.map((row) => row.digestDate)).toEqual(['2026-08-01']);
  });
});

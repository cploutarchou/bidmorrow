/**
 * Tender-corpus repository integration tests against real D1 (workerd).
 *
 * Covers the version-history invariants from docs/data-model.md §4:
 * idempotent notice upserts, immutable correction history with a moving
 * current pointer, and lot/CPV/geography insertion for a version.
 *
 * The test file shares one database (vitest-pool-workers 0.21 isolates per
 * FILE, not per test), so every test works on its own `source_notice_id`
 * and scopes its assertions to it.
 */
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import {
  tenderCpvCodes,
  tenderGeographies,
  tenderLots,
  tenderNoticeVersions,
} from '../schema/tender';
import { T0, testDb } from '../test/helpers';
import { insertSnapshotIfNewHash } from './ingestion';
import {
  getNoticeByPublicationNumber,
  insertCpvCodes,
  insertGeographies,
  insertLots,
  listLotsForScoring,
  upsertNoticeWithVersion,
  type UpsertNoticeWithVersionArgs,
} from './tender-corpus';

const SOURCE = 'ted';

async function insertSnapshot(
  db: Db,
  noticeId: string,
  versionNumber: number,
  contentHash: string,
) {
  const { snapshot } = await insertSnapshotIfNewHash(db, {
    source: SOURCE,
    sourceNoticeId: noticeId,
    versionNumber,
    r2Key: `${SOURCE}/2026/08/${noticeId}/v${versionNumber}.xml`,
    contentHash,
    sizeBytes: 2048,
    contentType: 'application/xml',
  });
  return snapshot;
}

function noticeArgs(
  sourceNoticeId: string,
  overrides: Partial<UpsertNoticeWithVersionArgs> = {},
): UpsertNoticeWithVersionArgs {
  return {
    source: SOURCE,
    sourceNoticeId,
    noticeType: 'cn-standard',
    procedureType: 'open',
    eformsSdkVersion: 'eforms-sdk-1.13',
    sourceLanguagesJson: JSON.stringify(['ENG']),
    sourceUrl: `https://ted.europa.eu/en/notice/-/detail/${sourceNoticeId}`,
    publicationDate: '2026-08-01',
    retrievedAt: T0,
    contentHash: 'hash-v1',
    snapshotId: 'MISSING', // always overridden with a real snapshot id
    ...overrides,
  };
}

async function versionsOf(db: Db, noticeId: string) {
  return db
    .select()
    .from(tenderNoticeVersions)
    .where(eq(tenderNoticeVersions.noticeId, noticeId))
    .orderBy(asc(tenderNoticeVersions.versionNumber));
}

describe('upsertNoticeWithVersion', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('is idempotent: the same notice + version twice yields a single row pair', async () => {
    const NOTICE = '00111111-2026';
    const snapshot = await insertSnapshot(db, NOTICE, 1, 'hash-a1');
    const args = noticeArgs(NOTICE, { snapshotId: snapshot.id, contentHash: 'hash-a1' });

    const first = await upsertNoticeWithVersion(db, args);
    expect(first).toMatchObject({ versionNumber: 1, versionCreated: true, noticeCreated: true });

    const second = await upsertNoticeWithVersion(db, args);
    expect(second).toMatchObject({
      noticeId: first.noticeId,
      versionId: first.versionId,
      versionNumber: 1,
      versionCreated: false,
      noticeCreated: false,
    });

    const notice = await getNoticeByPublicationNumber(db, {
      source: SOURCE,
      publicationNumber: NOTICE,
    });
    expect(notice?.id).toBe(first.noticeId);
    expect(notice?.currentVersionId).toBe(first.versionId);
    expect(await versionsOf(db, first.noticeId)).toHaveLength(1);
  });

  it('correction flow: version 2 preserves version 1 and moves the current pointer', async () => {
    const NOTICE = '00222222-2026';
    const snapshotV1 = await insertSnapshot(db, NOTICE, 1, 'hash-b1');
    const v1 = await upsertNoticeWithVersion(
      db,
      noticeArgs(NOTICE, { snapshotId: snapshotV1.id, contentHash: 'hash-b1' }),
    );
    expect(v1.versionCreated).toBe(true);

    const snapshotV2 = await insertSnapshot(db, NOTICE, 2, 'hash-b2');
    const v2 = await upsertNoticeWithVersion(
      db,
      noticeArgs(NOTICE, {
        snapshotId: snapshotV2.id,
        contentHash: 'hash-b2',
        publicationDate: '2026-08-05',
        retrievedAt: T0 + 4 * 86_400_000,
      }),
    );
    expect(v2).toMatchObject({
      noticeId: v1.noticeId,
      versionNumber: 2,
      versionCreated: true,
      noticeCreated: false,
    });
    expect(v2.versionId).not.toBe(v1.versionId);

    // Version 1 is immutable and still present, untouched.
    const versions = await versionsOf(db, v1.noticeId);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      id: v1.versionId,
      versionNumber: 1,
      contentHash: 'hash-b1',
      snapshotId: snapshotV1.id,
      publicationDate: '2026-08-01',
    });
    expect(versions[1]).toMatchObject({
      id: v2.versionId,
      versionNumber: 2,
      contentHash: 'hash-b2',
      snapshotId: snapshotV2.id,
      publicationDate: '2026-08-05',
    });

    // The notice repoints its current version, keeps its first-publication
    // date, and reflects the new content hash.
    const notice = await getNoticeByPublicationNumber(db, {
      source: SOURCE,
      publicationNumber: NOTICE,
    });
    expect(notice).toMatchObject({
      id: v1.noticeId,
      currentVersionId: v2.versionId,
      contentHash: 'hash-b2',
      publicationDate: '2026-08-01',
    });
  });

  it('inserts lots, CPV codes and geographies for a version and feeds scoring from the current version only', async () => {
    const NOTICE = '00333333-2026';
    const snapshotV1 = await insertSnapshot(db, NOTICE, 1, 'hash-c1');
    const v1 = await upsertNoticeWithVersion(
      db,
      noticeArgs(NOTICE, { snapshotId: snapshotV1.id, contentHash: 'hash-c1' }),
    );

    const lots = await insertLots(db, {
      noticeVersionId: v1.versionId,
      lots: [
        {
          lotNumber: 'LOT-0001',
          title: 'Managed IT services',
          description: 'Service desk and infrastructure operations',
          contractNature: 'services',
          estimatedValueAmount: 250_000,
          estimatedValueCurrency: 'EUR',
          estimatedValueEur: 250_000,
          valueIsDerived: false,
          deadlineAt: T0 + 30 * 86_400_000,
        },
        {
          lotNumber: 'LOT-0002',
          title: 'Network hardware',
          // Value not published — stays an explicit unknown, never 0.
          estimatedValueAmount: null,
          estimatedValueCurrency: null,
          estimatedValueEur: null,
          valueIsDerived: true,
          deadlineAt: null,
        },
      ],
    });
    expect(lots).toHaveLength(2);
    const firstLot = lots[0];
    const secondLot = lots[1];
    if (firstLot === undefined || secondLot === undefined) {
      throw new Error('insertLots returned fewer rows than requested');
    }

    const storedLots = await db
      .select()
      .from(tenderLots)
      .where(eq(tenderLots.noticeVersionId, v1.versionId))
      .orderBy(asc(tenderLots.lotNumber));
    expect(storedLots).toHaveLength(2);
    expect(storedLots[0]).toMatchObject({
      lotNumber: 'LOT-0001',
      estimatedValueEur: 250_000,
      valueIsDerived: 0,
    });
    expect(storedLots[1]).toMatchObject({
      lotNumber: 'LOT-0002',
      estimatedValueAmount: null,
      estimatedValueEur: null,
      valueIsDerived: 1,
      deadlineAt: null,
    });

    await insertCpvCodes(db, {
      entries: [
        { lotId: firstLot.id, cpvCode: '72000000', isMain: true },
        { lotId: firstLot.id, cpvCode: '72500000', isMain: false },
        { lotId: secondLot.id, cpvCode: '32420000', isMain: true },
      ],
    });
    const storedCpv = await db
      .select()
      .from(tenderCpvCodes)
      .where(eq(tenderCpvCodes.lotId, firstLot.id))
      .orderBy(asc(tenderCpvCodes.cpvCode));
    expect(storedCpv.map((row) => ({ cpvCode: row.cpvCode, isMain: row.isMain }))).toEqual([
      { cpvCode: '72000000', isMain: 1 },
      { cpvCode: '72500000', isMain: 0 },
    ]);

    await insertGeographies(db, {
      entries: [
        { lotId: firstLot.id, countryCode: 'CY', nutsCode: 'CY000' },
        { lotId: secondLot.id, countryCode: 'GR', nutsCode: null },
      ],
    });
    const firstGeo = await db
      .select()
      .from(tenderGeographies)
      .where(eq(tenderGeographies.lotId, firstLot.id));
    expect(
      firstGeo.map((row) => ({ countryCode: row.countryCode, nutsCode: row.nutsCode })),
    ).toEqual([{ countryCode: 'CY', nutsCode: 'CY000' }]);
    const secondGeo = await db
      .select()
      .from(tenderGeographies)
      .where(eq(tenderGeographies.lotId, secondLot.id));
    expect(secondGeo[0]).toMatchObject({ countryCode: 'GR', nutsCode: null });

    // A correction supersedes v1's lots in the scoring feed: only the current
    // version's lots are eligible.
    const snapshotV2 = await insertSnapshot(db, NOTICE, 2, 'hash-c2');
    const v2 = await upsertNoticeWithVersion(
      db,
      noticeArgs(NOTICE, { snapshotId: snapshotV2.id, contentHash: 'hash-c2' }),
    );
    const v2Lots = await insertLots(db, {
      noticeVersionId: v2.versionId,
      lots: [
        {
          lotNumber: 'LOT-0001',
          title: 'Managed IT services (corrected)',
          valueIsDerived: false,
        },
      ],
    });

    const scorable = await listLotsForScoring(db, {
      windowFrom: '2026-08-01',
      windowTo: '2026-08-31',
      limit: 100,
    });
    const thisNotice = scorable.items.filter((item) => item.sourceNoticeId === NOTICE);
    expect(thisNotice.map((item) => item.lot.id)).toEqual([v2Lots[0]?.id]);
    expect(thisNotice[0]?.noticeVersionId).toBe(v2.versionId);
  });
});

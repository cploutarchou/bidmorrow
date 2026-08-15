/**
 * `listFeedRows` integration tests against real D1 (workerd) — Phase 7.
 * Seeds notices/lots directly via the tender-corpus repository (no TED
 * fixtures needed — the feed query is what's under test, not ingestion) and
 * matches via `insertTenderMatches`, then exercises tab filtering, score
 * filtering, cursor pagination stability, expired-deadline exclusion, and
 * saved/ignored tabs. The file shares one D1 (vitest-pool-workers isolates
 * per FILE), so every test uses its own org + a distinct `source_notice_id`
 * prefix to stay independent.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import { T0, insertTestOrganization, testDb } from '../test/helpers';
import { insertSnapshotIfNewHash } from './ingestion';
import {
  insertCpvCodes,
  insertGeographies,
  insertLots,
  upsertNoticeWithVersion,
} from './tender-corpus';
import { ignoreTender, saveTender } from './engagement';
import { insertTenderMatches, listFeedRows, type TenderMatchInput } from './matching';

const SOURCE = 'ted';
const ENGINE_VERSION = '1';

interface SeededLot {
  readonly lotId: string;
  readonly noticeId: string;
}

/** Seeds one notice + one lot with a main CPV code and a country. */
async function seedLot(
  db: Db,
  sourceNoticeId: string,
  overrides: { deadlineAt?: number | null; valueEur?: number | null; country?: string } = {},
): Promise<SeededLot> {
  const { snapshot } = await insertSnapshotIfNewHash(db, {
    source: SOURCE,
    sourceNoticeId,
    versionNumber: 1,
    r2Key: `${SOURCE}/2026/08/${sourceNoticeId}/v1.xml`,
    contentHash: `hash-${sourceNoticeId}`,
    sizeBytes: 1024,
    contentType: 'application/xml',
  });
  const { noticeId, versionId } = await upsertNoticeWithVersion(db, {
    source: SOURCE,
    sourceNoticeId,
    noticeType: 'cn-standard',
    sourceLanguagesJson: JSON.stringify(['eng']),
    sourceUrl: `https://ted.europa.eu/notice/${sourceNoticeId}`,
    publicationDate: '2026-08-01',
    retrievedAt: T0,
    contentHash: `hash-${sourceNoticeId}`,
    snapshotId: snapshot.id,
  });
  const [lot] = await insertLots(db, {
    noticeVersionId: versionId,
    lots: [
      {
        lotNumber: '1',
        title: `Lot for ${sourceNoticeId}`,
        contractNature: 'services',
        estimatedValueAmount: overrides.valueEur ?? 100_000,
        estimatedValueCurrency: 'EUR',
        estimatedValueEur: overrides.valueEur ?? 100_000,
        valueIsDerived: false,
        deadlineAt:
          overrides.deadlineAt === undefined ? T0 + 30 * 86_400_000 : overrides.deadlineAt,
      },
    ],
  });
  if (lot === undefined) throw new Error('test setup: lot insert failed');
  await insertCpvCodes(db, { entries: [{ lotId: lot.id, cpvCode: '72000000', isMain: true }] });
  await insertGeographies(db, {
    entries: [{ lotId: lot.id, countryCode: overrides.country ?? 'CY' }],
  });
  return { lotId: lot.id, noticeId };
}

function matchInput(seed: SeededLot, score: number, scoredAt: number): TenderMatchInput {
  return {
    lotId: seed.lotId,
    noticeId: seed.noticeId,
    engineVersion: ENGINE_VERSION,
    score,
    classification:
      score >= 80
        ? 'STRONG_MATCH'
        : score >= 65
          ? 'WORTH_REVIEWING'
          : score >= 45
            ? 'POSSIBLE_MATCH'
            : 'LOW_FIT',
    scoredAt,
  };
}

describe('listFeedRows', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('filters by tab (strong/worth_reviewing/possible) and orders score DESC, id DESC', async () => {
    const { orgId } = await insertTestOrganization(db, 'Feed Tab Org');
    const strong = await seedLot(db, 'feed-tab-strong');
    const worthReviewing = await seedLot(db, 'feed-tab-worth');
    const possible = await seedLot(db, 'feed-tab-possible');
    const lowFit = await seedLot(db, 'feed-tab-low');

    await insertTenderMatches(db, orgId, {
      matches: [
        matchInput(strong, 90, T0),
        matchInput(worthReviewing, 70, T0),
        matchInput(possible, 50, T0),
        matchInput(lowFit, 20, T0),
      ],
    });

    const strongPage = await listFeedRows(db, orgId, {
      tab: 'strong',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
    });
    expect(strongPage.items.map((r) => r.lotId)).toEqual([strong.lotId]);
    expect(strongPage.items[0]?.classification).toBe('STRONG_MATCH');

    const possiblePage = await listFeedRows(db, orgId, {
      tab: 'possible',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
    });
    expect(possiblePage.items.map((r) => r.lotId)).toEqual([possible.lotId]);

    // LOW_FIT never appears in strong/worth_reviewing/possible tabs.
    const worthPage = await listFeedRows(db, orgId, {
      tab: 'worth_reviewing',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
    });
    expect(worthPage.items.map((r) => r.lotId)).toEqual([worthReviewing.lotId]);
  });

  it("'today' includes LOW_FIT scored within 24h but excludes older scores", async () => {
    const { orgId } = await insertTestOrganization(db, 'Feed Today Org');
    const recent = await seedLot(db, 'feed-today-recent');
    const old = await seedLot(db, 'feed-today-old');

    await insertTenderMatches(db, orgId, {
      matches: [matchInput(recent, 10, T0), matchInput(old, 90, T0 - 25 * 3_600_000)],
    });

    const page = await listFeedRows(db, orgId, {
      tab: 'today',
      engineVersion: ENGINE_VERSION,
      now: T0,
    });
    expect(page.items.map((r) => r.lotId)).toEqual([recent.lotId]);
  });

  it('minScore filters the feed', async () => {
    const { orgId } = await insertTestOrganization(db, 'Feed MinScore Org');
    const high = await seedLot(db, 'feed-minscore-high');
    const low = await seedLot(db, 'feed-minscore-low');
    await insertTenderMatches(db, orgId, {
      matches: [matchInput(high, 60, T0), matchInput(low, 46, T0)],
    });

    const page = await listFeedRows(db, orgId, {
      tab: 'possible',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
      minScore: 55,
    });
    expect(page.items.map((r) => r.lotId)).toEqual([high.lotId]);
  });

  it('cursor pagination is stable across pages (no duplicate/missing rows)', async () => {
    const { orgId } = await insertTestOrganization(db, 'Feed Cursor Org');
    const seeds = await Promise.all(
      Array.from({ length: 5 }, (_, i) => seedLot(db, `feed-cursor-${i}`)),
    );
    await insertTenderMatches(db, orgId, {
      matches: seeds.map((seed, i) => matchInput(seed, 50 + i, T0)),
    });

    const firstPage = await listFeedRows(db, orgId, {
      tab: 'possible',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
      limit: 2,
    });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listFeedRows(db, orgId, {
      tab: 'possible',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
      limit: 2,
      ...(firstPage.nextCursor !== null ? { cursor: firstPage.nextCursor } : {}),
    });
    expect(secondPage.items).toHaveLength(2);

    const seenLotIds = [...firstPage.items, ...secondPage.items].map((r) => r.lotId);
    expect(new Set(seenLotIds).size).toBe(4);
    // Descending score order across the page boundary.
    const scores = [...firstPage.items, ...secondPage.items].map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => (b ?? 0) - (a ?? 0)));
  });

  it('excludes expired-deadline lots from scored tabs but keeps them in saved/ignored', async () => {
    const { orgId, userId } = await insertTestOrganization(db, 'Feed Expiry Org');
    const expired = await seedLot(db, 'feed-expiry-expired', { deadlineAt: T0 - 1000 });
    await insertTenderMatches(db, orgId, { matches: [matchInput(expired, 90, T0)] });

    const strongPage = await listFeedRows(db, orgId, {
      tab: 'strong',
      engineVersion: ENGINE_VERSION,
      now: T0 + 5000,
    });
    expect(strongPage.items).toEqual([]);

    await saveTender(db, orgId, {
      lotId: expired.lotId,
      noticeId: expired.noticeId,
      savedByUserId: userId,
    });
    const savedPage = await listFeedRows(db, orgId, {
      tab: 'saved',
      engineVersion: ENGINE_VERSION,
      now: T0 + 5000,
    });
    expect(savedPage.items.map((r) => r.lotId)).toEqual([expired.lotId]);
  });

  it('saved/ignored tabs reflect engagement state and flags; other orgs never see them', async () => {
    const { orgId: orgA, userId: userA } = await insertTestOrganization(db, 'Feed Saved Org A');
    const { orgId: orgB } = await insertTestOrganization(db, 'Feed Saved Org B');
    const saved = await seedLot(db, 'feed-saved-lot');
    const ignored = await seedLot(db, 'feed-ignored-lot');
    await insertTenderMatches(db, orgA, {
      matches: [matchInput(saved, 55, T0), matchInput(ignored, 55, T0)],
    });

    await saveTender(db, orgA, {
      lotId: saved.lotId,
      noticeId: saved.noticeId,
      savedByUserId: userA,
    });
    await ignoreTender(db, orgA, {
      lotId: ignored.lotId,
      noticeId: ignored.noticeId,
      ignoredByUserId: userA,
    });

    const savedPage = await listFeedRows(db, orgA, {
      tab: 'saved',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
    });
    expect(savedPage.items).toHaveLength(1);
    expect(savedPage.items[0]?.lotId).toBe(saved.lotId);
    expect(savedPage.items[0]?.savedByYou).toBe(true);
    expect(savedPage.items[0]?.ignoredByYou).toBe(false);

    const ignoredPage = await listFeedRows(db, orgA, {
      tab: 'ignored',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
    });
    expect(ignoredPage.items.map((r) => r.lotId)).toEqual([ignored.lotId]);

    // Org B never sees org A's matches at all (no rows for it), regardless of tab.
    const orgBPossible = await listFeedRows(db, orgB, {
      tab: 'possible',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
    });
    expect(orgBPossible.items).toEqual([]);
    const orgBSaved = await listFeedRows(db, orgB, {
      tab: 'saved',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
    });
    expect(orgBSaved.items).toEqual([]);
  });
});

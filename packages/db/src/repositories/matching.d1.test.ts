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
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import { T0, insertTestOrganization, testDb } from '../test/helpers';
import { insertSnapshotIfNewHash } from './ingestion';
import { matchComponents, tenderMatches } from '../schema/matching';
import {
  insertCpvCodes,
  insertGeographies,
  insertLots,
  upsertBuyer,
  upsertNoticeWithVersion,
} from './tender-corpus';
import { ignoreTender, saveTender } from './engagement';
import {
  insertTenderMatches,
  listFeedRows,
  replaceTenderMatches,
  type TenderMatchInput,
} from './matching';

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
  overrides: {
    deadlineAt?: number | null;
    valueEur?: number | null;
    country?: string;
    buyerName?: string;
    cpvCode?: string;
  } = {},
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
  const buyerId =
    overrides.buyerName !== undefined
      ? (
          await upsertBuyer(db, {
            source: SOURCE,
            sourceBuyerId: `buyer-${sourceNoticeId}`,
            name: overrides.buyerName,
          })
        ).id
      : null;
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
    buyerId,
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
  await insertCpvCodes(db, {
    entries: [{ lotId: lot.id, cpvCode: overrides.cpvCode ?? '72000000', isMain: true }],
  });
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

  it('buyerName filter treats a literal "%" as a literal character, not a wildcard (SEC-P7-03)', async () => {
    const { orgId } = await insertTestOrganization(db, 'Feed LIKE Escape Org');
    const literalMatch = await seedLot(db, 'feed-like-buyer-literal', {
      buyerName: 'Acme 50% Holdings',
    });
    const decoyMatch = await seedLot(db, 'feed-like-buyer-decoy', {
      buyerName: 'Acme 500 Holdings',
    });
    await insertTenderMatches(db, orgId, {
      matches: [matchInput(literalMatch, 55, T0), matchInput(decoyMatch, 55, T0 - 1)],
    });

    const page = await listFeedRows(db, orgId, {
      tab: 'possible',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
      buyerName: '50%',
    });
    // Without ESCAPE handling, the `%` in "50%" would act as a SQL wildcard
    // and also match "Acme 500 Holdings" (which contains "50" then any
    // chars). Only the buyer whose name contains the literal substring
    // "50%" must match.
    expect(page.items.map((r) => r.lotId)).toEqual([literalMatch.lotId]);
  });

  it('cpvPrefix filter treats a literal "_" as a literal character, not a single-char wildcard (SEC-P7-03)', async () => {
    const { orgId } = await insertTestOrganization(db, 'Feed LIKE Escape CPV Org');
    const literalMatch = await seedLot(db, 'feed-like-cpv-literal', { cpvCode: '72_00000' });
    const decoyMatch = await seedLot(db, 'feed-like-cpv-decoy', { cpvCode: '72A00000' });
    await insertTenderMatches(db, orgId, {
      matches: [matchInput(literalMatch, 55, T0), matchInput(decoyMatch, 55, T0 - 1)],
    });

    const page = await listFeedRows(db, orgId, {
      tab: 'possible',
      engineVersion: ENGINE_VERSION,
      now: T0 + 1000,
      cpvPrefix: '72_',
    });
    // Without ESCAPE handling, `_` acts as a SQL single-char wildcard and
    // would also match "72A00000". Only the literal "72_" prefix must match.
    expect(page.items.map((r) => r.lotId)).toEqual([literalMatch.lotId]);
  });
});

/**
 * P-4 write-batching scale tests (docs/phase12-quality-findings.md): prove
 * `insertTenderMatches`/`replaceTenderMatches` handle a batch of matches
 * comfortably larger than `ID_CHUNK_SIZE` (90, the repository's own D1
 * bound-parameter chunk size for the bulk existence check) in ONE call,
 * with exact insert/skip/delete counts and no duplicate or missing rows —
 * the scenario `scoreLotsForOrgs`'s per-org flush buffer (`FLUSH_CHUNK_SIZE`
 * in `@bidmorrow/procurement`) produces in production.
 */
describe('insertTenderMatches / replaceTenderMatches at scale (P-4)', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  // Comfortably larger than ID_CHUNK_SIZE (90): the bulk existence check
  // must issue 2 chunked queries (90 + 65) and correctly resolve both.
  const MATCH_COUNT = 155;

  it('insertTenderMatches: one call with 155 matches inserts every one, with correct components; re-running skips all 155', async () => {
    const { orgId } = await insertTestOrganization(db, 'Scale Insert Org');
    const seeds: SeededLot[] = [];
    for (let i = 0; i < MATCH_COUNT; i++) {
      seeds.push(await seedLot(db, `scale-insert-${String(i)}`));
    }

    // Every 10th match scores STRONG_MATCH (carries components/risk flags —
    // exercises the FK-safe parent-then-children statement ordering within
    // the single combined `db.batch` across many candidates).
    const matches: TenderMatchInput[] = seeds.map((seed, i) => {
      const strong = i % 10 === 0;
      return {
        lotId: seed.lotId,
        noticeId: seed.noticeId,
        engineVersion: ENGINE_VERSION,
        score: strong ? 90 : 50,
        classification: strong ? 'STRONG_MATCH' : 'POSSIBLE_MATCH',
        scoredAt: T0,
        ...(strong
          ? {
              components: [
                {
                  componentKey: 'cpv',
                  points: 30,
                  maxPoints: 30,
                  status: 'MATCHED',
                  explanation: 'CPV matched',
                },
              ],
              riskFlags: [
                {
                  type: 'certification',
                  evidence: 'ISO 9001 required',
                  sourceField: 'description',
                  confidence: 'HIGH',
                  explanation: 'Certification risk',
                },
              ],
            }
          : {}),
      };
    });

    const first = await insertTenderMatches(db, orgId, { matches });
    expect(first).toEqual({ inserted: MATCH_COUNT, skipped: 0 });

    const countRow = await db
      .select({ id: tenderMatches.id })
      .from(tenderMatches)
      .where(eq(tenderMatches.organizationId, orgId));
    expect(countRow).toHaveLength(MATCH_COUNT);

    const strongCount = seeds.filter((_, i) => i % 10 === 0).length;
    const componentRows = await db
      .select({ id: matchComponents.id })
      .from(matchComponents)
      .innerJoin(tenderMatches, eq(matchComponents.matchId, tenderMatches.id))
      .where(eq(tenderMatches.organizationId, orgId));
    expect(componentRows).toHaveLength(strongCount);

    // Re-run with the SAME 155 matches: the bulk existence check (chunked at
    // ID_CHUNK_SIZE=90) must resolve every one as already existing — nothing
    // in the second 65-id chunk is missed, and nothing is double-inserted.
    const second = await insertTenderMatches(db, orgId, { matches });
    expect(second).toEqual({ inserted: 0, skipped: MATCH_COUNT });

    const countAfterRerun = await db
      .select({ id: tenderMatches.id })
      .from(tenderMatches)
      .where(eq(tenderMatches.organizationId, orgId));
    expect(countAfterRerun).toHaveLength(MATCH_COUNT);
  });

  it('replaceTenderMatches: one call hard-replaces 155 existing matches with a fresh set, deleting exactly the old rows', async () => {
    const { orgId } = await insertTestOrganization(db, 'Scale Replace Org');
    const seeds: SeededLot[] = [];
    for (let i = 0; i < MATCH_COUNT; i++) {
      seeds.push(await seedLot(db, `scale-replace-${String(i)}`));
    }
    const lotIds = seeds.map((seed) => seed.lotId);

    const originalMatches = seeds.map((seed, i) => matchInput(seed, 50 + (i % 30), T0));
    const seeded = await insertTenderMatches(db, orgId, { matches: originalMatches });
    expect(seeded).toEqual({ inserted: MATCH_COUNT, skipped: 0 });

    const originalIds = await db
      .select({ id: tenderMatches.id })
      .from(tenderMatches)
      .where(eq(tenderMatches.organizationId, orgId));
    expect(originalIds).toHaveLength(MATCH_COUNT);

    // Corrected re-score: every match's score changes. `lotIds` spans all
    // 155 lots — the delete-lookup select is chunked at ID_CHUNK_SIZE=90.
    const correctedMatches = seeds.map((seed, i) => matchInput(seed, 60 + (i % 30), T0 + 1000));
    const replaced = await replaceTenderMatches(db, orgId, {
      lotIds,
      engineVersion: ENGINE_VERSION,
      matches: correctedMatches,
    });
    expect(replaced).toEqual({ deleted: MATCH_COUNT, inserted: MATCH_COUNT });

    const rows = await db
      .select({
        id: tenderMatches.id,
        score: tenderMatches.score,
      })
      .from(tenderMatches)
      .where(eq(tenderMatches.organizationId, orgId));
    expect(rows).toHaveLength(MATCH_COUNT);
    // Every original id was replaced — no old row survives the hard replace.
    const originalIdSet = new Set(originalIds.map((row) => row.id));
    expect(rows.every((row) => !originalIdSet.has(row.id))).toBe(true);
    expect(rows.every((row) => (row.score ?? 0) >= 60)).toBe(true);

    // Repeated recompute never leaves duplicate rows.
    const replacedAgain = await replaceTenderMatches(db, orgId, {
      lotIds,
      engineVersion: ENGINE_VERSION,
      matches: correctedMatches,
    });
    expect(replacedAgain).toEqual({ deleted: MATCH_COUNT, inserted: MATCH_COUNT });

    const finalRows = await db
      .select({ id: tenderMatches.id })
      .from(tenderMatches)
      .where(eq(tenderMatches.organizationId, orgId));
    expect(finalRows).toHaveLength(MATCH_COUNT);
  });
});

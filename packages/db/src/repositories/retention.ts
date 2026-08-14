/**
 * GLOBAL repository — retention purge (docs/ted-ingestion-scope.md
 * "Retention & archival policy", ADR-0003). No `organization_id` args per
 * docs/security.md C6 — these tables are global.
 *
 * The purge job is notice-granular: a notice is a purge candidate only when
 * EVERY lot on its CURRENT version is both past its retention cutoff and
 * unpinned. A lot is pinned (exempt) when:
 *  - it is saved by any organization (`saved_tenders`), or
 *  - any of its scored matches carries customer feedback
 *    (`customer_feedback` — "pins the referenced match (and its lot) against
 *    purge so feedback stays interpretable", engagement.ts).
 *
 * Eligibility itself (retention-day math) is a PURE function in
 * `@bidmorrow/procurement` (`selectEligibleNoticeIds`) so it is unit
 * testable without a database; this module only fetches the raw rows it
 * needs and performs the FK-safe cascade delete.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { Db } from '../client';
import { customerFeedback, digestItems, savedTenders } from '../schema/engagement';
import { matchComponents, matchRiskFlags, tenderMatches } from '../schema/matching';
import {
  tenderCpvCodes,
  tenderGeographies,
  tenderLots,
  tenderNoticeVersions,
  tenderNotices,
} from '../schema/tender';

/** One current-version lot, with the facts retention eligibility needs. */
export interface RetentionLotRow {
  readonly lotId: string;
  readonly noticeId: string;
  /** `YYYY-MM-DD`, the notice's first-publication date. */
  readonly publicationDate: string;
  readonly deadlineAt: number | null;
}

/** D1 chunk size for `inArray(...)` — stays well under SQLite's bound-parameter cap. */
const ID_CHUNK_SIZE = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Every lot belonging to a notice's CURRENT version, for un-archived
 * notices. Bounded by `limit` notices' worth of lots is NOT applied here —
 * the caller (packages/procurement) applies the notice-count bound after
 * grouping, since a notice's eligibility can only be decided once ALL of its
 * lots are known.
 */
export async function listCurrentVersionLots(db: Db): Promise<RetentionLotRow[]> {
  const rows = await db
    .select({
      lotId: tenderLots.id,
      noticeId: tenderNotices.id,
      publicationDate: tenderNotices.publicationDate,
      deadlineAt: tenderLots.deadlineAt,
    })
    .from(tenderLots)
    .innerJoin(tenderNoticeVersions, eq(tenderLots.noticeVersionId, tenderNoticeVersions.id))
    .innerJoin(
      tenderNotices,
      and(
        eq(tenderNoticeVersions.noticeId, tenderNotices.id),
        eq(tenderNotices.currentVersionId, tenderNoticeVersions.id),
      ),
    )
    .where(isNull(tenderNotices.archivedAt));
  return rows;
}

/** Lot ids saved by any organization — pinned against purge. */
export async function listSavedLotIds(db: Db): Promise<Set<string>> {
  const rows = await db.select({ lotId: savedTenders.lotId }).from(savedTenders);
  return new Set(rows.map((r) => r.lotId));
}

/**
 * Lot ids whose scored matches carry customer feedback — pinned against
 * purge (feedback must stay interpretable against real lot data).
 */
export async function listFeedbackPinnedLotIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ lotId: tenderMatches.lotId })
    .from(customerFeedback)
    .innerJoin(tenderMatches, eq(customerFeedback.matchId, tenderMatches.id));
  return new Set(rows.map((r) => r.lotId));
}

export interface PurgeCounts {
  readonly noticesDeleted: number;
  readonly versionsDeleted: number;
  readonly lotsDeleted: number;
  readonly matchesDeleted: number;
  readonly digestItemsDetached: number;
}

const EMPTY_COUNTS: PurgeCounts = {
  noticesDeleted: 0,
  versionsDeleted: 0,
  lotsDeleted: 0,
  matchesDeleted: 0,
  digestItemsDetached: 0,
};

/**
 * Deletes a bounded set of notices and every row that depends on them, in
 * FK-safe order (deepest first). Every notice id passed in MUST already have
 * been verified eligible (no pinned lots) by the caller — this function
 * performs no eligibility re-check, only the mechanical cascade.
 */
export async function deleteNoticesCascade(
  db: Db,
  noticeIds: readonly string[],
): Promise<PurgeCounts> {
  if (noticeIds.length === 0) {
    return EMPTY_COUNTS;
  }

  // Breaks the circular FK (tender_notices.current_version_id ->
  // tender_notice_versions.id, tender_notice_versions.notice_id ->
  // tender_notices.id) BEFORE either side is deleted — otherwise deleting a
  // version while a notice still points to it as `current_version_id`
  // fails the FK constraint.
  for (const idsChunk of chunk(noticeIds, ID_CHUNK_SIZE)) {
    await db
      .update(tenderNotices)
      .set({ currentVersionId: null, updatedAt: Date.now() })
      .where(inArray(tenderNotices.id, idsChunk));
  }

  const versionIds: string[] = [];
  for (const idsChunk of chunk(noticeIds, ID_CHUNK_SIZE)) {
    const rows = await db
      .select({ id: tenderNoticeVersions.id })
      .from(tenderNoticeVersions)
      .where(inArray(tenderNoticeVersions.noticeId, idsChunk));
    versionIds.push(...rows.map((r) => r.id));
  }

  const lotIds: string[] = [];
  for (const idsChunk of chunk(versionIds, ID_CHUNK_SIZE)) {
    if (idsChunk.length === 0) continue;
    const rows = await db
      .select({ id: tenderLots.id })
      .from(tenderLots)
      .where(inArray(tenderLots.noticeVersionId, idsChunk));
    lotIds.push(...rows.map((r) => r.id));
  }

  const matchIds: string[] = [];
  for (const idsChunk of chunk(lotIds, ID_CHUNK_SIZE)) {
    if (idsChunk.length === 0) continue;
    const rows = await db
      .select({ id: tenderMatches.id })
      .from(tenderMatches)
      .where(inArray(tenderMatches.lotId, idsChunk));
    matchIds.push(...rows.map((r) => r.id));
  }

  let digestItemsDetached = 0;
  for (const idsChunk of chunk(matchIds, ID_CHUNK_SIZE)) {
    if (idsChunk.length === 0) continue;
    // digest_items.match_id SET NULL on purge (docs/data-model.md §7) — the
    // row itself (title/score/classification snapshots) is retained.
    const updated = await db
      .update(digestItems)
      .set({ matchId: null, updatedAt: Date.now() })
      .where(inArray(digestItems.matchId, idsChunk))
      .returning({ id: digestItems.id });
    digestItemsDetached += updated.length;

    await db.delete(matchRiskFlags).where(inArray(matchRiskFlags.matchId, idsChunk));
    await db.delete(matchComponents).where(inArray(matchComponents.matchId, idsChunk));
  }
  for (const idsChunk of chunk(matchIds, ID_CHUNK_SIZE)) {
    if (idsChunk.length === 0) continue;
    await db.delete(tenderMatches).where(inArray(tenderMatches.id, idsChunk));
  }

  for (const idsChunk of chunk(lotIds, ID_CHUNK_SIZE)) {
    if (idsChunk.length === 0) continue;
    await db.delete(tenderGeographies).where(inArray(tenderGeographies.lotId, idsChunk));
    await db.delete(tenderCpvCodes).where(inArray(tenderCpvCodes.lotId, idsChunk));
  }
  for (const idsChunk of chunk(lotIds, ID_CHUNK_SIZE)) {
    if (idsChunk.length === 0) continue;
    await db.delete(tenderLots).where(inArray(tenderLots.id, idsChunk));
  }

  for (const idsChunk of chunk(versionIds, ID_CHUNK_SIZE)) {
    if (idsChunk.length === 0) continue;
    await db.delete(tenderNoticeVersions).where(inArray(tenderNoticeVersions.id, idsChunk));
  }

  for (const idsChunk of chunk(noticeIds, ID_CHUNK_SIZE)) {
    await db.delete(tenderNotices).where(inArray(tenderNotices.id, idsChunk));
  }

  return {
    noticesDeleted: noticeIds.length,
    versionsDeleted: versionIds.length,
    lotsDeleted: lotIds.length,
    matchesDeleted: matchIds.length,
    digestItemsDetached,
  };
}

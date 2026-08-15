/**
 * GLOBAL repository — shared tender corpus (docs/data-model.md §3, §4).
 *
 * These tables are global (no `organization_id`): the corpus is shared by
 * every customer organization, so per docs/security.md C6 no function here
 * takes an organizationId. Tenant-owned scoring results live in the
 * matching repositories.
 *
 * Writers are the single ingestion cron/queue consumer (ADR-0006); the
 * select-then-write upserts here assume that single-writer model, and every
 * uniqueness assumption is additionally backed by a DB unique index so a
 * duplicate write fails loudly instead of corrupting the corpus.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte } from 'drizzle-orm';

import type { Db } from '../client';
import { newId } from '../id';
import {
  buyers,
  tenderCpvCodes,
  tenderGeographies,
  tenderLots,
  tenderNotices,
  tenderNoticeVersions,
} from '../schema/tender';
import { assertIsoDate, chunkForInsert, normalizeLimit, toPage } from './shared';
import type { Page, Pagination } from './shared';

export type Buyer = typeof buyers.$inferSelect;
export type TenderNotice = typeof tenderNotices.$inferSelect;
export type TenderNoticeVersion = typeof tenderNoticeVersions.$inferSelect;
export type TenderLot = typeof tenderLots.$inferSelect;
export type TenderCpvCode = typeof tenderCpvCodes.$inferSelect;
export type TenderGeography = typeof tenderGeographies.$inferSelect;

// ---------------------------------------------------------------------------
// Buyers
// ---------------------------------------------------------------------------

export interface UpsertBuyerArgs {
  readonly source: string;
  /** eForms organization id when the source provides one. */
  readonly sourceBuyerId?: string | null;
  readonly name: string;
  /** ISO-3166-1 alpha-2. */
  readonly countryCode?: string | null;
  readonly buyerLegalType?: string | null;
  readonly buyerActivity?: string | null;
}

/**
 * Upserts a buyer by its natural key (docs/data-model.md §3): primary key is
 * `(source, source_buyer_id)` when the source provides a stable buyer id;
 * otherwise the dedupe fallback `(source, name, country_code)` — restricted
 * to rows that themselves have no `source_buyer_id`, so a name collision can
 * never merge two distinct identified buyers. Descriptive fields are
 * refreshed on match (dedupe/enrichment may update them).
 */
export async function upsertBuyer(db: Db, args: UpsertBuyerArgs): Promise<Buyer> {
  const now = Date.now();
  const sourceBuyerId = args.sourceBuyerId ?? null;
  const countryCode = args.countryCode ?? null;

  const naturalKey =
    sourceBuyerId !== null
      ? and(eq(buyers.source, args.source), eq(buyers.sourceBuyerId, sourceBuyerId))
      : and(
          eq(buyers.source, args.source),
          isNull(buyers.sourceBuyerId),
          eq(buyers.name, args.name),
          countryCode === null ? isNull(buyers.countryCode) : eq(buyers.countryCode, countryCode),
        );

  const existing = (await db.select().from(buyers).where(naturalKey).limit(1))[0];

  if (existing !== undefined) {
    const updated = await db
      .update(buyers)
      .set({
        name: args.name,
        countryCode,
        buyerLegalType: args.buyerLegalType ?? existing.buyerLegalType,
        buyerActivity: args.buyerActivity ?? existing.buyerActivity,
        updatedAt: now,
      })
      .where(eq(buyers.id, existing.id))
      .returning();
    const row = updated[0];
    if (row === undefined) {
      throw new Error(`upsertBuyer: buyer ${existing.id} vanished during upsert`);
    }
    return row;
  }

  const inserted = await db
    .insert(buyers)
    .values({
      id: newId(),
      source: args.source,
      sourceBuyerId,
      name: args.name,
      countryCode,
      buyerLegalType: args.buyerLegalType ?? null,
      buyerActivity: args.buyerActivity ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const row = inserted[0];
  if (row === undefined) {
    throw new Error('upsertBuyer: insert returned no row');
  }
  return row;
}

// ---------------------------------------------------------------------------
// Notices & versions
// ---------------------------------------------------------------------------

export interface UpsertNoticeWithVersionArgs {
  readonly source: string;
  /** e.g. TED publication number. */
  readonly sourceNoticeId: string;
  readonly buyerId?: string | null;
  /** eForms notice subtype. */
  readonly noticeType: string;
  readonly procedureType?: string | null;
  readonly eformsSdkVersion?: string | null;
  /** JSON array of language codes, pre-serialized by the mapper. */
  readonly sourceLanguagesJson: string;
  readonly sourceUrl: string;
  /**
   * `YYYY-MM-DD` publication date of THIS version. For a new notice it also
   * becomes `tender_notices.publication_date` (first publication); on a
   * correction the notice keeps its original first-publication date.
   */
  readonly publicationDate: string;
  /** When we fetched it; defaults to now. */
  readonly retrievedAt?: number;
  /** Content hash of this version's payload (change detection). */
  readonly contentHash: string;
  /** FK → source_snapshots: raw payload already archived in R2 (ADR-0005). */
  readonly snapshotId: string;
  /** Provenance FK → ingestion_runs. */
  readonly ingestionRunId?: string | null;
}

export interface UpsertNoticeWithVersionResult {
  readonly noticeId: string;
  /** The notice's current version after the call. */
  readonly versionId: string;
  readonly versionNumber: number;
  /** False when `content_hash` was unchanged and no version was inserted. */
  readonly versionCreated: boolean;
  /** True when the notice row itself was newly inserted. */
  readonly noticeCreated: boolean;
}

/**
 * Idempotent notice upsert with immutable version history
 * (docs/data-model.md §4, query patterns #6/#8):
 *
 * - keyed on the unique `(source, source_notice_id)` — re-fetching upserts,
 *   never duplicates;
 * - an unchanged `content_hash` is a no-op (no version row inserted);
 * - a new/changed payload INSERTS a new `tender_notice_versions` row
 *   (`version_number` = previous max + 1, unique per notice) and repoints
 *   `tender_notices.current_version_id`. Prior version rows are immutable
 *   and NEVER updated or overwritten;
 * - the multi-statement write runs in a single atomic `db.batch`.
 */
export async function upsertNoticeWithVersion(
  db: Db,
  args: UpsertNoticeWithVersionArgs,
): Promise<UpsertNoticeWithVersionResult> {
  assertIsoDate(args.publicationDate, 'publicationDate');
  const now = Date.now();
  const retrievedAt = args.retrievedAt ?? now;

  const existing = (
    await db
      .select()
      .from(tenderNotices)
      .where(
        and(
          eq(tenderNotices.source, args.source),
          eq(tenderNotices.sourceNoticeId, args.sourceNoticeId),
        ),
      )
      .limit(1)
  )[0];

  if (existing === undefined) {
    const noticeId = newId();
    const versionId = newId();
    await db.batch([
      db.insert(tenderNotices).values({
        id: noticeId,
        source: args.source,
        sourceNoticeId: args.sourceNoticeId,
        currentVersionId: null,
        buyerId: args.buyerId ?? null,
        noticeType: args.noticeType,
        procedureType: args.procedureType ?? null,
        eformsSdkVersion: args.eformsSdkVersion ?? null,
        sourceLanguagesJson: args.sourceLanguagesJson,
        sourceUrl: args.sourceUrl,
        publicationDate: args.publicationDate,
        retrievedAt,
        contentHash: args.contentHash,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(tenderNoticeVersions).values({
        id: versionId,
        noticeId,
        versionNumber: 1,
        publicationDate: args.publicationDate,
        contentHash: args.contentHash,
        snapshotId: args.snapshotId,
        eformsSdkVersion: args.eformsSdkVersion ?? null,
        ingestionRunId: args.ingestionRunId ?? null,
        createdAt: now,
      }),
      db
        .update(tenderNotices)
        .set({ currentVersionId: versionId, updatedAt: now })
        .where(eq(tenderNotices.id, noticeId)),
    ]);
    return { noticeId, versionId, versionNumber: 1, versionCreated: true, noticeCreated: true };
  }

  const latestVersion = (
    await db
      .select()
      .from(tenderNoticeVersions)
      .where(eq(tenderNoticeVersions.noticeId, existing.id))
      .orderBy(desc(tenderNoticeVersions.versionNumber))
      .limit(1)
  )[0];

  if (
    existing.contentHash === args.contentHash &&
    existing.currentVersionId !== null &&
    latestVersion !== undefined
  ) {
    return {
      noticeId: existing.id,
      versionId: existing.currentVersionId,
      versionNumber: latestVersion.versionNumber,
      versionCreated: false,
      noticeCreated: false,
    };
  }

  const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
  const versionId = newId();
  await db.batch([
    db.insert(tenderNoticeVersions).values({
      id: versionId,
      noticeId: existing.id,
      versionNumber,
      publicationDate: args.publicationDate,
      contentHash: args.contentHash,
      snapshotId: args.snapshotId,
      eformsSdkVersion: args.eformsSdkVersion ?? null,
      ingestionRunId: args.ingestionRunId ?? null,
      createdAt: now,
    }),
    db
      .update(tenderNotices)
      .set({
        currentVersionId: versionId,
        buyerId: args.buyerId ?? existing.buyerId,
        noticeType: args.noticeType,
        procedureType: args.procedureType ?? null,
        eformsSdkVersion: args.eformsSdkVersion ?? null,
        sourceLanguagesJson: args.sourceLanguagesJson,
        sourceUrl: args.sourceUrl,
        retrievedAt,
        contentHash: args.contentHash,
        updatedAt: now,
      })
      .where(eq(tenderNotices.id, existing.id)),
  ]);
  return {
    noticeId: existing.id,
    versionId,
    versionNumber,
    versionCreated: true,
    noticeCreated: false,
  };
}

/**
 * Highest `version_number` recorded for a notice, or 0 if it has none yet.
 * Ingestion (packages/procurement) uses this to compute the version number a
 * NEW snapshot row would get (the actual version row is only inserted by
 * `upsertNoticeWithVersion` if the content hash actually changed).
 */
export async function getLatestVersionNumber(db: Db, noticeId: string): Promise<number> {
  const row = (
    await db
      .select({ versionNumber: tenderNoticeVersions.versionNumber })
      .from(tenderNoticeVersions)
      .where(eq(tenderNoticeVersions.noticeId, noticeId))
      .orderBy(desc(tenderNoticeVersions.versionNumber))
      .limit(1)
  )[0];
  return row?.versionNumber ?? 0;
}

export interface GetNoticeByPublicationNumberArgs {
  readonly source: string;
  /** The source's notice identifier, e.g. TED publication number. */
  readonly publicationNumber: string;
}

/** Looks up a notice by its source-native publication number (unique per source). */
export async function getNoticeByPublicationNumber(
  db: Db,
  args: GetNoticeByPublicationNumberArgs,
): Promise<TenderNotice | null> {
  const row = (
    await db
      .select()
      .from(tenderNotices)
      .where(
        and(
          eq(tenderNotices.source, args.source),
          eq(tenderNotices.sourceNoticeId, args.publicationNumber),
        ),
      )
      .limit(1)
  )[0];
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Lots, CPV codes, geographies (immutable rows belonging to one version)
// ---------------------------------------------------------------------------

export interface NewLotInput {
  /** `LOT-0001`-style eForms id, or `1` for lotless notices. */
  readonly lotNumber: string;
  readonly title: string;
  readonly description?: string | null;
  readonly contractNature?: string | null;
  /** Null = value not published — unknown is explicit, never 0. */
  readonly estimatedValueAmount?: number | null;
  /** ISO-4217; null iff amount is null. */
  readonly estimatedValueCurrency?: string | null;
  /** Derived EUR conversion (ADR-0004); null when unconvertible. */
  readonly estimatedValueEur?: number | null;
  /** True when the procedure total was divided across lots. */
  readonly valueIsDerived: boolean;
  /** Null = no deadline (some procedure types) — explicit unknown. */
  readonly deadlineAt?: number | null;
}

export interface InsertLotsArgs {
  readonly noticeVersionId: string;
  readonly lots: readonly NewLotInput[];
}

/** Column counts drive `chunkForInsert` sizing under D1's bound-parameter cap. */
const LOT_COLUMNS = 12;
const CPV_COLUMNS = 5;
const GEOGRAPHY_COLUMNS = 5;

/**
 * Inserts the lot rows for one notice version (immutable — corrections get a
 * new version with its own lots; nothing is updated in place). Returns the
 * inserted rows so the caller can attach CPV codes and geographies by lot id.
 */
export async function insertLots(db: Db, args: InsertLotsArgs): Promise<TenderLot[]> {
  if (args.lots.length === 0) {
    return [];
  }
  const now = Date.now();
  const rows: TenderLot[] = args.lots.map((lot) => ({
    id: newId(),
    noticeVersionId: args.noticeVersionId,
    lotNumber: lot.lotNumber,
    title: lot.title,
    description: lot.description ?? null,
    contractNature: lot.contractNature ?? null,
    estimatedValueAmount: lot.estimatedValueAmount ?? null,
    estimatedValueCurrency: lot.estimatedValueCurrency ?? null,
    estimatedValueEur: lot.estimatedValueEur ?? null,
    valueIsDerived: lot.valueIsDerived ? 1 : 0,
    deadlineAt: lot.deadlineAt ?? null,
    createdAt: now,
  }));
  for (const batch of chunkForInsert(rows, LOT_COLUMNS)) {
    await db.insert(tenderLots).values(batch);
  }
  return rows;
}

export interface NewCpvCodeInput {
  readonly lotId: string;
  /** 8 digits, check digit stripped. */
  readonly cpvCode: string;
  readonly isMain: boolean;
}

/**
 * Inserts CPV classification rows for freshly inserted lots. Rows are
 * immutable; unique `(lot_id, cpv_code)` rejects duplicates — the mapper
 * dedupes before calling.
 */
export async function insertCpvCodes(
  db: Db,
  args: { readonly entries: readonly NewCpvCodeInput[] },
): Promise<TenderCpvCode[]> {
  if (args.entries.length === 0) {
    return [];
  }
  const now = Date.now();
  const rows: TenderCpvCode[] = args.entries.map((entry) => ({
    id: newId(),
    lotId: entry.lotId,
    cpvCode: entry.cpvCode,
    isMain: entry.isMain ? 1 : 0,
    createdAt: now,
  }));
  for (const batch of chunkForInsert(rows, CPV_COLUMNS)) {
    await db.insert(tenderCpvCodes).values(batch);
  }
  return rows;
}

export interface NewGeographyInput {
  readonly lotId: string;
  /** ISO-3166-1 alpha-2. */
  readonly countryCode: string;
  /** Null when the source gives only a country. */
  readonly nutsCode?: string | null;
}

/**
 * Inserts geography rows for freshly inserted lots. No DB unique constraint
 * exists (NULL `nuts_code`, docs/data-model.md §4) — the mapper dedupes
 * in-app before calling.
 */
export async function insertGeographies(
  db: Db,
  args: { readonly entries: readonly NewGeographyInput[] },
): Promise<TenderGeography[]> {
  if (args.entries.length === 0) {
    return [];
  }
  const now = Date.now();
  const rows: TenderGeography[] = args.entries.map((entry) => ({
    id: newId(),
    lotId: entry.lotId,
    countryCode: entry.countryCode,
    nutsCode: entry.nutsCode ?? null,
    createdAt: now,
  }));
  for (const batch of chunkForInsert(rows, GEOGRAPHY_COLUMNS)) {
    await db.insert(tenderGeographies).values(batch);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Scoring feed
// ---------------------------------------------------------------------------

export interface ListLotsForScoringArgs extends Pagination {
  /** `YYYY-MM-DD` inclusive window start (notice publication date). */
  readonly windowFrom: string;
  /** `YYYY-MM-DD` inclusive window end. */
  readonly windowTo: string;
}

export interface ScorableLot {
  readonly lot: TenderLot;
  readonly noticeId: string;
  readonly noticeVersionId: string;
  readonly source: string;
  readonly sourceNoticeId: string;
  readonly buyerId: string | null;
  readonly publicationDate: string;
}

/**
 * Lists lots eligible for scoring in a publication window: lots of each
 * notice's CURRENT version only, notices not archived. Ordered by lot id
 * ascending — ULIDs are time-sortable, so the order is deterministic
 * creation order and the id doubles as the pagination cursor.
 */
export async function listLotsForScoring(
  db: Db,
  args: ListLotsForScoringArgs,
): Promise<Page<ScorableLot>> {
  assertIsoDate(args.windowFrom, 'windowFrom');
  assertIsoDate(args.windowTo, 'windowTo');
  const limit = normalizeLimit(args.limit);

  const rows = await db
    .select({
      lot: tenderLots,
      noticeId: tenderNotices.id,
      noticeVersionId: tenderNoticeVersions.id,
      source: tenderNotices.source,
      sourceNoticeId: tenderNotices.sourceNoticeId,
      buyerId: tenderNotices.buyerId,
      publicationDate: tenderNotices.publicationDate,
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
    .where(
      and(
        gte(tenderNotices.publicationDate, args.windowFrom),
        lte(tenderNotices.publicationDate, args.windowTo),
        isNull(tenderNotices.archivedAt),
        args.cursor === undefined ? undefined : gt(tenderLots.id, args.cursor),
      ),
    )
    .orderBy(asc(tenderLots.id))
    .limit(limit + 1);

  return toPage(rows, limit, (row) => row.lot.id);
}

// ---------------------------------------------------------------------------
// Scoring input bundles (Phase 6): everything the engine-input mapper needs
// for a set of lots, in a small fixed number of queries.
// ---------------------------------------------------------------------------

export interface LotScoringBundle {
  readonly lot: TenderLot;
  readonly noticeId: string;
  readonly sourceLanguagesJson: string;
  readonly procedureType: string | null;
  readonly buyerLegalType: string | null;
  readonly cpvCodes: readonly TenderCpvCode[];
  readonly geographies: readonly TenderGeography[];
}

/**
 * Loads everything `@bidmorrow/procurement`'s engine-input mapper needs for
 * the given lot ids — notice languages/procedure type, buyer legal type, CPV
 * codes, and geographies — in four bounded queries regardless of lot count.
 * Lots are returned in the same order they exist in the corpus (no
 * ordering guarantee vs. `lotIds` input order — callers that care must
 * re-key by `lot.id`). Skips ids that no longer resolve (deleted/purged)
 * rather than throwing — recompute call sites must tolerate that.
 */
export async function loadLotScoringBundlesByIds(
  db: Db,
  lotIds: readonly string[],
): Promise<LotScoringBundle[]> {
  if (lotIds.length === 0) return [];
  const rows = await db
    .select({
      lot: tenderLots,
      noticeId: tenderNotices.id,
      sourceLanguagesJson: tenderNotices.sourceLanguagesJson,
      procedureType: tenderNotices.procedureType,
      buyerLegalType: buyers.buyerLegalType,
    })
    .from(tenderLots)
    .innerJoin(tenderNoticeVersions, eq(tenderLots.noticeVersionId, tenderNoticeVersions.id))
    .innerJoin(tenderNotices, eq(tenderNoticeVersions.noticeId, tenderNotices.id))
    .leftJoin(buyers, eq(tenderNotices.buyerId, buyers.id))
    .where(inArray(tenderLots.id, [...lotIds]));

  return attachCpvAndGeography(db, rows);
}

/**
 * Loads the scoring bundles for the CURRENT-version lots of the given
 * notices — used by the recompute path after a correction (a new notice
 * version's lots replace the prior version's for scoring purposes).
 */
export async function loadLotScoringBundlesForNotices(
  db: Db,
  noticeIds: readonly string[],
): Promise<LotScoringBundle[]> {
  if (noticeIds.length === 0) return [];
  const rows = await db
    .select({
      lot: tenderLots,
      noticeId: tenderNotices.id,
      sourceLanguagesJson: tenderNotices.sourceLanguagesJson,
      procedureType: tenderNotices.procedureType,
      buyerLegalType: buyers.buyerLegalType,
    })
    .from(tenderLots)
    .innerJoin(
      tenderNoticeVersions,
      and(
        eq(tenderLots.noticeVersionId, tenderNoticeVersions.id),
        eq(tenderNoticeVersions.id, tenderNotices.currentVersionId),
      ),
    )
    .innerJoin(tenderNotices, eq(tenderNoticeVersions.noticeId, tenderNotices.id))
    .leftJoin(buyers, eq(tenderNotices.buyerId, buyers.id))
    .where(inArray(tenderNotices.id, [...noticeIds]));

  return attachCpvAndGeography(db, rows);
}

async function attachCpvAndGeography(
  db: Db,
  rows: {
    lot: TenderLot;
    noticeId: string;
    sourceLanguagesJson: string;
    procedureType: string | null;
    buyerLegalType: string | null;
  }[],
): Promise<LotScoringBundle[]> {
  if (rows.length === 0) return [];
  const lotIds = rows.map((row) => row.lot.id);
  const [cpvRows, geoRows] = await db.batch([
    db.select().from(tenderCpvCodes).where(inArray(tenderCpvCodes.lotId, lotIds)),
    db.select().from(tenderGeographies).where(inArray(tenderGeographies.lotId, lotIds)),
  ]);
  const cpvByLot = new Map<string, TenderCpvCode[]>();
  for (const cpv of cpvRows) {
    const list = cpvByLot.get(cpv.lotId) ?? [];
    list.push(cpv);
    cpvByLot.set(cpv.lotId, list);
  }
  const geoByLot = new Map<string, TenderGeography[]>();
  for (const geo of geoRows) {
    const list = geoByLot.get(geo.lotId) ?? [];
    list.push(geo);
    geoByLot.set(geo.lotId, list);
  }
  return rows.map((row) => ({
    lot: row.lot,
    noticeId: row.noticeId,
    sourceLanguagesJson: row.sourceLanguagesJson,
    procedureType: row.procedureType,
    buyerLegalType: row.buyerLegalType,
    cpvCodes: cpvByLot.get(row.lot.id) ?? [],
    geographies: geoByLot.get(row.lot.id) ?? [],
  }));
}

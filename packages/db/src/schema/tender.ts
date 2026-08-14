/**
 * Tender corpus tables (docs/data-model.md §3 buyers, §4 tender corpus) —
 * GLOBAL tables (no organization_id): the corpus is shared across all
 * customer organizations; tenant-owned scoring results live in the matching
 * schema area.
 *
 * Conventions (docs/data-model.md): TEXT ULID ids generated in the
 * application, INTEGER epoch-millis `*_at` timestamps (`created_at` on every
 * table, `updated_at` only on mutable tables), TEXT `YYYY-MM-DD` `*_date`
 * calendar dates, INTEGER 0/1 booleans, `_json` TEXT columns. No ON DELETE
 * CASCADE — deletes are explicit application-level operations
 * (docs/data-model.md §11 Retention & archival).
 */
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { ingestionRuns, sourceSnapshots } from './ingestion';

/**
 * Normalized buyer entities, deduplicated across notices. Feeds the
 * buyer/sector matching component and future award-history enrichment.
 * Mutable: dedupe/enrichment may update descriptive fields.
 */
export const buyers = sqliteTable(
  'buyers',
  {
    id: text('id').primaryKey(),
    /** Source system, `ted` in V1 — source-agnostic like notices. */
    source: text('source').notNull(),
    /** eForms organization id when the source provides one. */
    sourceBuyerId: text('source_buyer_id'),
    name: text('name').notNull(),
    /** ISO-3166-1 alpha-2. */
    countryCode: text('country_code'),
    /** eForms buyer-legal-type code. */
    buyerLegalType: text('buyer_legal_type'),
    /** eForms main-activity code. */
    buyerActivity: text('buyer_activity'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    // Partial unique: sources without a stable buyer id fall back to the
    // (source, name, country_code) dedupe index below.
    uniqueIndex('uq_buyers__source_source_buyer_id')
      .on(t.source, t.sourceBuyerId)
      .where(sql`${t.sourceBuyerId} IS NOT NULL`),
    index('idx_buyers__source_name_country_code').on(t.source, t.name, t.countryCode),
  ],
);

/**
 * One row per procurement notice, source-agnostic (`ProcurementSource`
 * interface); the notice is the stable identity across corrections.
 * Mutable: `current_version_id`, `content_hash` and `archived_at` move as
 * corrections arrive / the retention job archives.
 */
export const tenderNotices = sqliteTable(
  'tender_notices',
  {
    id: text('id').primaryKey(),
    /** `ted` in V1. */
    source: text('source').notNull(),
    /** e.g. TED publication number. */
    sourceNoticeId: text('source_notice_id').notNull(),
    /**
     * Null only during the insert transaction, then always set. Lazily typed
     * — circular FK pair with `tender_notice_versions.notice_id`.
     */
    currentVersionId: text('current_version_id').references(
      (): AnySQLiteColumn => tenderNoticeVersions.id,
    ),
    buyerId: text('buyer_id').references(() => buyers.id),
    /** eForms notice subtype; V1 ingests COMPETITION types only. */
    noticeType: text('notice_type').notNull(),
    /** open/restricted/negotiated… (notice-level in eForms). Source vocabulary, no CHECK. */
    procedureType: text('procedure_type'),
    /** Null for non-eForms sources. */
    eformsSdkVersion: text('eforms_sdk_version'),
    /** JSON array of language codes present in the source notice. */
    sourceLanguagesJson: text('source_languages_json').notNull(),
    /** Canonical link to the original notice. */
    sourceUrl: text('source_url').notNull(),
    /** `YYYY-MM-DD` of first publication. */
    publicationDate: text('publication_date').notNull(),
    /** When we fetched it. */
    retrievedAt: integer('retrieved_at').notNull(),
    /** Hash of the current version content (change detection). */
    contentHash: text('content_hash').notNull(),
    /** Set by the retention job; archived notices leave the feed. */
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    // Ingestion idempotency: re-fetching a notice upserts, never duplicates.
    uniqueIndex('uq_tender_notices__source_source_notice_id').on(t.source, t.sourceNoticeId),
    // Ingestion window queries, admin browsing.
    index('idx_tender_notices__publication_date').on(t.publicationDate),
    // Purge job scans (partial: only archived rows are candidates).
    index('idx_tender_notices__archived_at')
      .on(t.archivedAt)
      .where(sql`${t.archivedAt} IS NOT NULL`),
  ],
);

/**
 * One row per published version/correction. Rows are immutable — a
 * correction inserts a new version and repoints
 * `tender_notices.current_version_id`; history is never overwritten.
 */
export const tenderNoticeVersions = sqliteTable(
  'tender_notice_versions',
  {
    id: text('id').primaryKey(),
    noticeId: text('notice_id')
      .notNull()
      .references(() => tenderNotices.id),
    /** 1..n in publication order. */
    versionNumber: integer('version_number').notNull(),
    /** `YYYY-MM-DD` of this version. */
    publicationDate: text('publication_date').notNull(),
    contentHash: text('content_hash').notNull(),
    /** Raw payload lives in R2 (ADR-0005); the snapshot row is metadata only. */
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => sourceSnapshots.id),
    /** Can change between versions. */
    eformsSdkVersion: text('eforms_sdk_version'),
    /** Provenance: which ingestion run created this version. */
    ingestionRunId: text('ingestion_run_id').references(() => ingestionRuns.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    // Version insert idempotency.
    uniqueIndex('uq_tender_notice_versions__notice_id_version_number').on(
      t.noticeId,
      t.versionNumber,
    ),
  ],
);

/**
 * The matching unit. Belongs to a notice *version* (a correction can change
 * lots; each version carries its own lot rows). Immutable, like the version
 * rows it belongs to. NUTS lives in `tender_geographies`, CPV in
 * `tender_cpv_codes` — both are multi-valued.
 */
export const tenderLots = sqliteTable(
  'tender_lots',
  {
    id: text('id').primaryKey(),
    noticeVersionId: text('notice_version_id')
      .notNull()
      .references(() => tenderNoticeVersions.id),
    /** `LOT-0001`-style eForms id, or `1` for lotless notices. */
    lotNumber: text('lot_number').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** works/supplies/services. Source vocabulary, no CHECK. */
    contractNature: text('contract_nature'),
    /** Null = value not published — unknown is explicit, never 0. */
    estimatedValueAmount: real('estimated_value_amount'),
    /** ISO-4217; null iff `estimated_value_amount` is null. */
    estimatedValueCurrency: text('estimated_value_currency'),
    /** Derived conversion (ADR-0004); null when unconvertible → value component UNKNOWN. */
    estimatedValueEur: real('estimated_value_eur'),
    /** 0/1; 1 when the procedure total was divided across lots (component scored PARTIAL). */
    valueIsDerived: integer('value_is_derived').notNull(),
    /** Submission deadline; null = no deadline (some procedure types) — explicit unknown. */
    deadlineAt: integer('deadline_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_tender_lots__notice_version_id_lot_number').on(t.noticeVersionId, t.lotNumber),
    // Feed expiry filtering and the retention job's `deadline + N days` scan.
    index('idx_tender_lots__deadline_at').on(t.deadlineAt),
  ],
);

/** Lot CPV classifications (multi-valued). Immutable. */
export const tenderCpvCodes = sqliteTable(
  'tender_cpv_codes',
  {
    id: text('id').primaryKey(),
    lotId: text('lot_id')
      .notNull()
      .references(() => tenderLots.id),
    /** 8 digits, check digit stripped. */
    cpvCode: text('cpv_code').notNull(),
    /** 0/1; 1 for the lot's main CPV (additional CPVs scored at 85%). */
    isMain: integer('is_main').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_tender_cpv_codes__lot_id_cpv_code').on(t.lotId, t.cpvCode),
    // Admin CPV scope analysis; future targeted rescoring.
    index('idx_tender_cpv_codes__cpv_code').on(t.cpvCode),
  ],
);

/**
 * Lot geographies (multi-valued). Immutable. No unique constraint: NULL
 * `nuts_code` makes SQLite unique semantics unhelpful; ingestion dedupes
 * in-app (docs/data-model.md §4).
 */
export const tenderGeographies = sqliteTable(
  'tender_geographies',
  {
    id: text('id').primaryKey(),
    lotId: text('lot_id')
      .notNull()
      .references(() => tenderLots.id),
    /** ISO-3166-1 alpha-2 (derivable from NUTS prefix; stored for query simplicity). */
    countryCode: text('country_code').notNull(),
    /** Null when the source gives only a country. */
    nutsCode: text('nuts_code'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_tender_geographies__lot_id').on(t.lotId)],
);

/**
 * ECB euro foreign exchange reference rates for value-fit scoring
 * (ADR-0004; docs/data-model.md §4). Refreshed by the ingestion cron; a rate
 * is valid for scoring if ≤ 7 days old. Mutable: a re-fetch upserts the same
 * (rate_date, currency) and moves `fetched_at` / `updated_at`.
 */
export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    id: text('id').primaryKey(),
    /** `YYYY-MM-DD` ECB reference date the rate was published for. */
    rateDate: text('rate_date').notNull(),
    /** ISO-4217 code, e.g. `SEK`. */
    currency: text('currency').notNull(),
    /** Multiplier converting one unit of `currency` into EUR (EUR = amount × rate_to_eur). */
    rateToEur: real('rate_to_eur').notNull(),
    /** When the rate was fetched from the ECB feed. */
    fetchedAt: integer('fetched_at').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_exchange_rates__rate_date_currency').on(t.rateDate, t.currency)],
);

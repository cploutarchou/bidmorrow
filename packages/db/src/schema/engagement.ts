/**
 * Customer actions, feedback, digest & email schema — docs/data-model.md
 * §7–§8 (`digest_preferences` lives in ./company with the other per-org
 * preference tables).
 *
 * All tables are [tenant-owned] except `email_deliveries`, which is
 * org-level for digests and user-level for auth mail — hence both FKs
 * nullable with a CHECK that at least one is set. `digest_items` inherits
 * tenancy through `digest_run_id` (like `match_components` through
 * `match_id`); access always goes via the org-checked parent row.
 *
 * Conventions (docs/data-model.md): TEXT ULID ids, INTEGER epoch-millis
 * `*_at` timestamps, TEXT `YYYY-MM-DD` `*_date` columns, INTEGER 0/1
 * booleans, TEXT + CHECK enums, `_json` TEXT columns.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { organizations, users } from './identity';
import { tenderMatches } from './matching';
import { tenderLots, tenderNotices } from './tender';

/**
 * [tenant-owned] Lot-level (aligned with matches; the feed row is a lot).
 * Saving pins the underlying tender data against retention purge.
 * Insert/delete lifecycle only — immutable, so `created_at` only.
 */
export const savedTenders = sqliteTable(
  'saved_tenders',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    lotId: text('lot_id')
      .notNull()
      .references(() => tenderLots.id),
    /** Denormalized, same rationale as tender_matches.notice_id. */
    noticeId: text('notice_id')
      .notNull()
      .references(() => tenderNotices.id),
    savedByUserId: text('saved_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    // Doubles as the Saved-tab index.
    uniqueIndex('uq_saved_tenders__organization_id_lot_id').on(t.organizationId, t.lotId),
    // Purge job checks "is this lot pinned?".
    index('idx_saved_tenders__lot_id').on(t.lotId),
  ],
);

/**
 * [tenant-owned] Identical shape to `saved_tenders` (with
 * `ignored_by_user_id` and optional `reason`). Ignoring removes the lot
 * from all feed tabs and does NOT pin against purge.
 */
export const ignoredTenders = sqliteTable(
  'ignored_tenders',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    lotId: text('lot_id')
      .notNull()
      .references(() => tenderLots.id),
    /** Denormalized, same rationale as tender_matches.notice_id. */
    noticeId: text('notice_id')
      .notNull()
      .references(() => tenderNotices.id),
    ignoredByUserId: text('ignored_by_user_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_ignored_tenders__organization_id_lot_id').on(t.organizationId, t.lotId),
    index('idx_ignored_tenders__lot_id').on(t.lotId),
  ],
);

/**
 * [tenant-owned] Useful / Not-useful verdicts with structured reasons.
 * Stored verbatim; never feeds back into scoring automatically. Pins the
 * referenced match (and its lot) against purge so feedback stays
 * interpretable. Changing your mind upserts (`updated_at` tracks it).
 */
export const customerFeedback = sqliteTable(
  'customer_feedback',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    matchId: text('match_id')
      .notNull()
      .references(() => tenderMatches.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    verdict: text('verdict').notNull(),
    /**
     * JSON array of structured reason codes (`wrong_cpv`, `wrong_geography`,
     * `too_large`, `too_small`, `not_our_work`, `deadline_too_close`,
     * `other`).
     */
    reasonsJson: text('reasons_json'),
    comment: text('comment'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    // One live verdict per match.
    uniqueIndex('uq_customer_feedback__organization_id_match_id').on(t.organizationId, t.matchId),
    // Per-org Useful/Not-useful trend (pilot success signal).
    index('idx_customer_feedback__organization_id_created_at').on(t.organizationId, t.createdAt),
    check('ck_customer_feedback__verdict', sql`${t.verdict} IN ('useful', 'not_useful')`),
  ],
);

/**
 * [tenant-owned] One attempted digest per org per day. The unique
 * constraint is the dedupe mechanism — the digest worker inserts first
 * (`INSERT ... ON CONFLICT DO NOTHING`); losing the insert means another
 * invocation owns today's digest. Status transitions move `updated_at`.
 */
export const digestRuns = sqliteTable(
  'digest_runs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** `YYYY-MM-DD` in the org's timezone. */
    digestDate: text('digest_date').notNull(),
    status: text('status').notNull(),
    matchesCount: integer('matches_count').notNull(),
    /** Null when skipped. */
    emailDeliveryId: text('email_delivery_id').references(() => emailDeliveries.id),
    sentAt: integer('sent_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    // DB-enforced "one digest per org per day".
    uniqueIndex('uq_digest_runs__organization_id_digest_date').on(t.organizationId, t.digestDate),
    check(
      'ck_digest_runs__status',
      sql`${t.status} IN ('pending', 'sent', 'skipped_empty', 'skipped_paused', 'failed')`,
    ),
  ],
);

/**
 * What a digest actually contained, with display snapshots so the row stays
 * meaningful after the underlying match is purged by retention. Tenancy
 * inherited through `digest_run_id`. Mutable only via the purge job's
 * `match_id` → SET NULL pass (`updated_at` tracks it).
 */
export const digestItems = sqliteTable(
  'digest_items',
  {
    id: text('id').primaryKey(),
    digestRunId: text('digest_run_id')
      .notNull()
      .references(() => digestRuns.id),
    /** SET NULL on purge of unpinned matches (application-level operation). */
    matchId: text('match_id').references(() => tenderMatches.id),
    /** Display order. */
    rank: integer('rank').notNull(),
    titleSnapshot: text('title_snapshot').notNull(),
    scoreSnapshot: real('score_snapshot'),
    classificationSnapshot: text('classification_snapshot').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_digest_items__digest_run_id_match_id').on(t.digestRunId, t.matchId),
    index('idx_digest_items__digest_run_id').on(t.digestRunId),
    // Purge SET NULL pass.
    index('idx_digest_items__match_id').on(t.matchId),
  ],
);

/**
 * Every outbound email (digest, verification, password reset, billing
 * notices). Org-level for digests, user-level for auth mail — hence both
 * FKs nullable, CHECK at least one set. `updated_at` moves on provider
 * status events.
 */
export const emailDeliveries = sqliteTable(
  'email_deliveries',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references(() => organizations.id),
    userId: text('user_id').references(() => users.id),
    kind: text('kind').notNull(),
    toEmail: text('to_email').notNull(),
    /** e.g. `resend`. */
    provider: text('provider').notNull(),
    /** For delivery-event correlation. */
    providerMessageId: text('provider_message_id'),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    // Admin "emails for this org".
    index('idx_email_deliveries__organization_id_created_at').on(t.organizationId, t.createdAt),
    // Webhook status updates resolve one row (partial unique).
    uniqueIndex('uq_email_deliveries__provider_provider_message_id')
      .on(t.provider, t.providerMessageId)
      .where(sql`${t.providerMessageId} IS NOT NULL`),
    check(
      'ck_email_deliveries__kind',
      sql`${t.kind} IN ('digest', 'verification', 'password_reset', 'billing')`,
    ),
    check(
      'ck_email_deliveries__status',
      sql`${t.status} IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed')`,
    ),
    check(
      'ck_email_deliveries__recipient',
      sql`${t.organizationId} IS NOT NULL OR ${t.userId} IS NOT NULL`,
    ),
  ],
);

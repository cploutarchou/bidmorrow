/**
 * Matching results schema — docs/data-model.md §6.
 *
 * `tender_matches` is [tenant-owned]. `match_components` and
 * `match_risk_flags` deliberately carry NO `organization_id`: tenancy is
 * inherited through `match_id`, and access always goes through the parent
 * match, which is org-checked (per the doc, they are not tenant-marked).
 *
 * All three tables are immutable: recomputation inserts new engine-version
 * rows and never mutates old ones, so they carry `created_at` only.
 *
 * Conventions (docs/data-model.md): TEXT ULID ids, INTEGER epoch-millis
 * `*_at` timestamps, TEXT + CHECK enums.
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
import { organizations } from './identity';
import { tenderLots, tenderNotices } from './tender';

/**
 * [tenant-owned] One row per (organization, lot, engine version) — the
 * engine-versioned score. Recomputation inserts new-version rows; it never
 * mutates old ones.
 */
export const tenderMatches = sqliteTable(
  'tender_matches',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    lotId: text('lot_id')
      .notNull()
      .references(() => tenderLots.id),
    /**
     * Denormalized — feed and detail queries group by notice without an
     * extra join through versions.
     */
    noticeId: text('notice_id')
      .notNull()
      .references(() => tenderNotices.id),
    /** e.g. `1`. */
    engineVersion: text('engine_version').notNull(),
    /**
     * 0–100; null when classification = EXCLUDED (no score shown). REAL
     * because the UNKNOWN policy yields half-points (7.5).
     */
    score: real('score'),
    classification: text('classification').notNull(),
    /**
     * Which hard rule fired (`excluded_geography`, `excluded_cpv`,
     * `excluded_phrase`, `unsupported_nature`, `deadline_below_threshold`);
     * null unless EXCLUDED. Rule set is engine config, not a DB enum.
     */
    exclusionRule: text('exclusion_rule'),
    /** Code/phrase/date that triggered the rule. */
    exclusionEvidence: text('exclusion_evidence'),
    /** Deadline-runway is time-dependent; this anchors reproducibility. */
    scoredAt: integer('scored_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    // Contractual; makes re-scoring idempotent per engine version.
    uniqueIndex('uq_tender_matches__organization_id_lot_id_engine_version').on(
      t.organizationId,
      t.lotId,
      t.engineVersion,
    ),
    // The feed query (org + latest engine version + classification tab, newest first).
    index('idx_tender_matches__organization_id_engine_version_classification_scored_at').on(
      t.organizationId,
      t.engineVersion,
      t.classification,
      t.scoredAt,
    ),
    // The hottest customer feed query (listFeedRows): org + latest engine
    // version, ORDER BY score DESC, id DESC — this is a covering sort index
    // so the DB avoids an in-memory sort on the default (no classification
    // filter, no cursor) feed page.
    index('idx_tender_matches__org_engine_score_id').on(
      t.organizationId,
      t.engineVersion,
      sql`${t.score} desc`,
      sql`${t.id} desc`,
    ),
    // Retention purge walks matches from expiring lots; admin match-trace for a lot.
    index('idx_tender_matches__lot_id').on(t.lotId),
    check(
      'ck_tender_matches__classification',
      sql`${t.classification} IN ('STRONG_MATCH', 'WORTH_REVIEWING', 'POSSIBLE_MATCH', 'LOW_FIT', 'EXCLUDED')`,
    ),
  ],
);

/**
 * Per-match score decomposition (components sum to the total — engine
 * invariant 2). ~8 rows per scored match. Not tenant-marked: tenancy is
 * inherited through `match_id`.
 */
export const matchComponents = sqliteTable(
  'match_components',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => tenderMatches.id),
    componentKey: text('component_key').notNull(),
    /** Awarded (7.5-style halves possible). */
    points: real('points').notNull(),
    /** Component max at this engine version. */
    maxPoints: real('max_points').notNull(),
    status: text('status').notNull(),
    /** Human-readable line, e.g. "value not published. Neutral score applied". */
    explanation: text('explanation').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    // Doubles as the match_id lookup index (tender detail explanation, digest rendering).
    uniqueIndex('uq_match_components__match_id_component_key').on(t.matchId, t.componentKey),
    check(
      'ck_match_components__component_key',
      sql`${t.componentKey} IN ('cpv', 'capability', 'geography', 'value', 'buyer', 'procedure_nature', 'deadline', 'eligibility')`,
    ),
    check(
      'ck_match_components__status',
      sql`${t.status} IN ('MATCHED', 'PARTIAL', 'NO_MATCH', 'UNKNOWN')`,
    ),
  ],
);

/**
 * 0..n per match; conservative, evidence-backed only (never fabricate a
 * requirement). Not tenant-marked: tenancy is inherited through `match_id`.
 */
export const matchRiskFlags = sqliteTable(
  'match_risk_flags',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => tenderMatches.id),
    type: text('type').notNull(),
    /** Quoted source snippet. */
    evidence: text('evidence').notNull(),
    /** Field path in the source notice the snippet came from. */
    sourceField: text('source_field').notNull(),
    confidence: text('confidence').notNull(),
    /**
     * Rendered wording ("Possible requirement detected — verify in source
     * documents.").
     */
    explanation: text('explanation').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_match_risk_flags__match_id').on(t.matchId),
    check(
      'ck_match_risk_flags__type',
      sql`${t.type} IN ('certification', 'security_clearance', 'insurance', 'financial_turnover', 'prior_experience', 'framework_membership', 'local_presence', 'mandatory_references')`,
    ),
    check('ck_match_risk_flags__confidence', sql`${t.confidence} IN ('HIGH', 'POSSIBLE')`),
  ],
);

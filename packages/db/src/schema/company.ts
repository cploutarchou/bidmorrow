/**
 * Company profile & preferences schema — docs/data-model.md §2 (plus
 * `digest_preferences` from §8, a per-org preference table owned here).
 *
 * Every table is [tenant-owned]: `organization_id TEXT NOT NULL FK →
 * organizations(id)` with an organization_id-leading index/unique. These
 * tables are small (tens of rows per org) and read as a whole on every
 * scoring pass, so each needs only its organization_id-leading key.
 *
 * Conventions (docs/data-model.md): TEXT ULID ids, INTEGER epoch-millis
 * `*_at` timestamps, INTEGER 0/1 booleans, TEXT + CHECK enums, `_json`
 * TEXT columns for opaque JSON payloads.
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

/** 1:1 with organization; descriptive profile + onboarding state. */
export const companyProfiles = sqliteTable(
  'company_profiles',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    displayName: text('display_name'),
    description: text('description'),
    website: text('website'),
    /** Free-text band, e.g. `5-10`, `11-25`, `26-50`. */
    employeeBand: text('employee_band'),
    /**
     * Which preset seeded onboarding (`cyber_consultancy`, `cloud_devops`,
     * `software_house`, `it_generalist`). Free text — preset list is
     * application config, not a DB enum.
     */
    presetKey: text('preset_key'),
    /** Null until onboarding finished. */
    onboardingCompletedAt: integer('onboarding_completed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_company_profiles__organization_id').on(t.organizationId)],
);

/** Free-text capabilities, normalized lower-case for matching. */
export const companyCapabilities = sqliteTable(
  'company_capabilities',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    label: text('label').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_company_capabilities__organization_id_label').on(t.organizationId, t.label),
  ],
);

/** Declared certifications, consumed by the eligibility/cert component. */
export const companyCertifications = sqliteTable(
  'company_certifications',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    certificationCode: text('certification_code').notNull(),
    /** Free-text detail when code = `OTHER`. */
    label: text('label'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_company_certifications__organization_id_certification_code_label').on(
      t.organizationId,
      t.certificationCode,
      t.label,
    ),
    check(
      'ck_company_certifications__certification_code',
      sql`${t.certificationCode} IN ('ISO_27001', 'ISO_9001', 'SOC2', 'OTHER')`,
    ),
  ],
);

/** CPV preferences: 8-digit CPV codes (check digit stripped). */
export const companyCpvPreferences = sqliteTable(
  'company_cpv_preferences',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    cpvCode: text('cpv_code').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_company_cpv_preferences__organization_id_cpv_code').on(
      t.organizationId,
      t.cpvCode,
    ),
  ],
);

/**
 * Geography preferences, one row per (kind, code). Excluded geographies live
 * in `company_exclusions`, not here — exclusion is a different behavior
 * (hard exclusion vs. scoring).
 */
export const companyGeographies = sqliteTable(
  'company_geographies',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').notNull(),
    /** NUTS code for `preferred_nuts`, ISO-3166-1 alpha-2 otherwise. */
    code: text('code').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_company_geographies__organization_id_kind_code').on(
      t.organizationId,
      t.kind,
      t.code,
    ),
    check(
      'ck_company_geographies__kind',
      sql`${t.kind} IN ('preferred_nuts', 'opportunity_country', 'country_served')`,
    ),
  ],
);

/**
 * Positive matching vocabulary. Excluded phrases are NOT kept here — they go
 * in `company_exclusions` so the hard-exclusion rule set is one table.
 */
export const companyKeywords = sqliteTable(
  'company_keywords',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').notNull(),
    /** Normalized (lower, diacritic-folded) phrase or word. */
    term: text('term').notNull(),
    /** Group label; required when kind = `synonym`, null for `positive`. */
    synonymGroup: text('synonym_group'),
    /** BCP-47; informs the "matchable language" set. */
    language: text('language'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_company_keywords__organization_id_kind_term').on(
      t.organizationId,
      t.kind,
      t.term,
    ),
    // Group-hit counting is per-group-once.
    index('idx_company_keywords__organization_id_synonym_group').on(
      t.organizationId,
      t.synonymGroup,
    ),
    check('ck_company_keywords__kind', sql`${t.kind} IN ('positive', 'synonym')`),
    check(
      'ck_company_keywords__synonym_group',
      sql`(${t.kind} = 'synonym' AND ${t.synonymGroup} IS NOT NULL) OR (${t.kind} = 'positive' AND ${t.synonymGroup} IS NULL)`,
    ),
  ],
);

/** Inputs to the five hard-exclusion rules. */
export const companyExclusions = sqliteTable(
  'company_exclusions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').notNull(),
    /** CPV prefix / ISO country / NUTS prefix / normalized phrase / nature code. */
    value: text('value').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_company_exclusions__organization_id_kind_value').on(
      t.organizationId,
      t.kind,
      t.value,
    ),
    check(
      'ck_company_exclusions__kind',
      sql`${t.kind} IN ('cpv_family', 'country', 'nuts', 'phrase', 'contract_nature')`,
    ),
  ],
);

/** 1:1 with organization; scalar knobs the matching engine reads. */
export const matchingPreferences = sqliteTable(
  'matching_preferences',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** Null = no bound. */
    minValueEur: real('min_value_eur'),
    /** Null = no bound. */
    maxValueEur: real('max_value_eur'),
    /** JSON array, e.g. `["services","supplies"]`. */
    supportedContractNaturesJson: text('supported_contract_natures_json').notNull(),
    /** Null = threshold unset (deadline rule scores 0 instead of hard-excluding). */
    minimumDaysRemaining: integer('minimum_days_remaining'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_matching_preferences__organization_id').on(t.organizationId)],
);

/** 1:1 with organization; digest email preferences (docs/data-model.md §8). */
export const digestPreferences = sqliteTable(
  'digest_preferences',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    enabled: integer('enabled').notNull().default(1),
    /** Only send when meaningful matches exist unless opted in. */
    sendEmpty: integer('send_empty').notNull().default(0),
    /** Lowest classification included in the digest. */
    minClassification: text('min_classification').notNull().default('WORTH_REVIEWING'),
    /** IANA tz; drives which "day" a digest_date covers. */
    timezone: text('timezone').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_digest_preferences__organization_id').on(t.organizationId),
    check(
      'ck_digest_preferences__min_classification',
      sql`${t.minClassification} IN ('STRONG_MATCH', 'WORTH_REVIEWING', 'POSSIBLE_MATCH', 'LOW_FIT')`,
    ),
  ],
);

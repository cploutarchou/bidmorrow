/**
 * Ops, analytics & admin schema — docs/data-model.md §10.
 *
 * Tenant linkage varies per the doc: `product_events` is org-linked but
 * nullable (anonymous/marketing events); `audit_events` carries actor
 * fields plus a nullable affected-org; `support_notes` is [tenant-owned];
 * `feature_flags` is global. Append-only tables (`product_events`,
 * `audit_events`) carry `created_at` only.
 *
 * Conventions (docs/data-model.md): TEXT ULID ids, INTEGER epoch-millis
 * `*_at` timestamps, TEXT + CHECK enums, `_json` TEXT columns for opaque
 * JSON payloads.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizations, users } from './identity';

/** Minimal first-party analytics (no third-party tooling). Append-only. */
export const productEvents = sqliteTable(
  'product_events',
  {
    id: text('id').primaryKey(),
    /** Null for anonymous/marketing events. */
    organizationId: text('organization_id').references(() => organizations.id),
    userId: text('user_id').references(() => users.id),
    /** e.g. `feed_viewed`, `digest_opened`, `match_expanded`. */
    name: text('name').notNull(),
    propertiesJson: text('properties_json'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    // Metric counts over time.
    index('idx_product_events__name_created_at').on(t.name, t.createdAt),
    // Per-org activity (pilot success signals).
    index('idx_product_events__organization_id_created_at').on(t.organizationId, t.createdAt),
  ],
);

/** Append-only audit log for security-relevant and admin actions. */
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorType: text('actor_type').notNull(),
    /** users.id for user/admin, null for system (no FK per the doc). */
    actorId: text('actor_id'),
    /** The org affected, when applicable. */
    organizationId: text('organization_id').references(() => organizations.id),
    /** Stable verb, e.g. `feature_flag.updated`, `recompute.triggered`, `org.deleted`. */
    action: text('action').notNull(),
    /** e.g. `feature_flag`, `organization`, `subscription`. */
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    /** Compact human-readable before/after state. */
    beforeSummary: text('before_summary'),
    afterSummary: text('after_summary'),
    occurredAt: integer('occurred_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_audit_events__organization_id_occurred_at').on(t.organizationId, t.occurredAt),
    // "Who changed this flag?".
    index('idx_audit_events__target_type_target_id').on(t.targetType, t.targetId),
    check('ck_audit_events__actor_type', sql`${t.actorType} IN ('user', 'admin', 'system')`),
  ],
);

/**
 * [tenant-owned] Internal admin notes about a customer org (visible to
 * INTERNAL_ADMIN only — enforced in the app layer, never rendered to
 * customers). Author must pass the admin allowlist check.
 */
export const supportNotes = sqliteTable(
  'support_notes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_support_notes__organization_id_created_at').on(t.organizationId, t.createdAt)],
);

/**
 * Global admin-editable runtime configuration. Values are JSON so one table
 * serves booleans, numbers and structured config. Every flag change writes
 * an `audit_events` row.
 */
export const featureFlags = sqliteTable(
  'feature_flags',
  {
    id: text('id').primaryKey(),
    /**
     * `founding_plan_open`, `founding_cap`, `ingestion_paused`,
     * `digest_paused`, `ingestion_cpv_scope`.
     */
    key: text('key').notNull(),
    /** e.g. `true`, `20`, `{"divisions":["72","79"],"extra_codes":[...]}`. */
    valueJson: text('value_json').notNull(),
    /** What the flag does and safe values. */
    description: text('description').notNull(),
    updatedByUserId: text('updated_by_user_id').references(() => users.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_feature_flags__key').on(t.key)],
);

/**
 * Identity & tenancy schema — docs/data-model.md §1.
 *
 * AUTH TABLES DECISION (Phase 3, recorded):
 * `users` is created NOW as a minimal placeholder carrying only the expected
 * core columns from docs/data-model.md (id, email unique, email_verified,
 * name, created_at, updated_at) so that foreign keys elsewhere in the schema
 * (organizations, organization_members, saved_tenders, …) resolve.
 * `auth_accounts` and `auth_sessions` are NOT created in Phase 3 — Better
 * Auth's schema generator produces them in Phase 4 and reconciles `users`
 * too. Do not hand-extend `users` ahead of that generation.
 *
 * Conventions (docs/data-model.md): TEXT ULID ids, INTEGER epoch-millis
 * `*_at` timestamps, INTEGER 0/1 booleans, TEXT + CHECK enums.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Placeholder per AUTH TABLES DECISION above — reconciled by Better Auth in Phase 4. */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified').notNull(),
    name: text('name'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_users__email').on(t.email)],
);

/**
 * The tenant root. Everything customer-owned hangs off this table.
 * No index beyond PK: org lookups are by id (from session → membership).
 */
export const organizations = sqliteTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Soft-delete gate while the purge job hard-deletes owned rows. */
    status: text('status').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [check('ck_organizations__status', sql`${t.status} IN ('active', 'deleted')`)],
);

/**
 * [tenant-owned] Membership of users in organizations.
 * INTERNAL_ADMIN is deliberately absent from `role` — it is an app-level
 * flag resolved from an email allowlist in configuration, never a row here.
 */
export const organizationMembers = sqliteTable(
  'organization_members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_organization_members__organization_id_user_id').on(t.organizationId, t.userId),
    // Every authenticated request resolves "which org(s) does this user belong to".
    index('idx_organization_members__user_id').on(t.userId),
    check('ck_organization_members__role', sql`${t.role} IN ('ORGANIZATION_OWNER', 'MEMBER')`),
  ],
);

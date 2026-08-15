/**
 * Identity & tenancy schema — docs/data-model.md §1.
 *
 * AUTH TABLES DECISION (Phase 4, reconciled):
 * `users`, `auth_accounts`, `auth_sessions`, `auth_verifications` and
 * `auth_rate_limits` are Better Auth 1.6.x CORE tables (ADR-0002, ADR-0007
 * — core auth only, no organization plugin), hand-mapped to our snake_case
 * naming via the `@better-auth/drizzle-adapter` `modelName`/`fields`
 * mapping configured in `packages/auth`. The Better Auth CLI
 * (`npx @better-auth/cli generate`) does not know our table-name mapping,
 * so it cannot generate this file directly — this hand-authored schema,
 * cross-checked against Better Auth's documented core schema
 * (docs/content/docs/concepts/database.mdx core schema tables +
 * concepts/rate-limit.mdx database-storage schema), is authoritative.
 *
 * DEVIATION from the repo's plain-INTEGER-epoch-millis convention: Better
 * Auth's adapter passes native JS `Date` objects for every field it
 * documents as type `Date` (timestamps: created_at/updated_at/expires_at/
 * *_expires_at), and a native `boolean` for `email_verified`. Drizzle's
 * `integer(..., { mode: 'timestamp_ms' })` / `{ mode: 'boolean' }` column
 * modes convert those JS values to/from plain INTEGER storage
 * automatically, so the on-disk representation is still an INTEGER
 * epoch-millis / 0-1 column — only the JS-side type differs from the rest
 * of the schema, because Better Auth (not our repositories) owns writes to
 * these five tables exclusively. `auth_rate_limits.last_request` is
 * documented as a plain number ("bigint", epoch ms) rather than `Date`, so
 * it stays a plain `integer` column with no mode, matching the rest of the
 * repo's convention. Recorded in docs/data-model.md §1.
 *
 * Conventions (docs/data-model.md): TEXT ULID ids, INTEGER epoch-millis
 * `*_at` timestamps, INTEGER 0/1 booleans, TEXT + CHECK enums.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Better Auth core `user` model, mapped to `users` (modelName) — ADR-0002/0007. */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
    name: text('name'),
    /** Better Auth core field; unused by V1 (no OAuth/avatar upload yet). */
    image: text('image'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('uq_users__email').on(t.email)],
);

/**
 * Better Auth core `account` model, mapped to `auth_accounts` — credential
 * (and future OAuth) accounts per user. V1 only uses the `credential`
 * provider (email + password); the OAuth-only columns stay nullable.
 */
export const authAccounts = sqliteTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    idToken: text('id_token'),
    /** Password hash, `credential` provider only. */
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('idx_auth_accounts__user_id').on(t.userId)],
);

/**
 * Better Auth core `session` model, mapped to `auth_sessions` — DB-backed
 * sessions (ADR-0002). Indexed by `user_id` for revoke-all on password
 * reset / account deletion.
 */
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    token: text('token').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_auth_sessions__token').on(t.token),
    index('idx_auth_sessions__user_id').on(t.userId),
  ],
);

/**
 * Better Auth core `verification` model, mapped to `auth_verifications` —
 * email-verification and password-reset tokens.
 */
export const authVerifications = sqliteTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('idx_auth_verifications__identifier').on(t.identifier)],
);

/**
 * Better Auth's built-in rate limiter, database storage (ADR-0002 — the
 * in-memory default is unusable on Workers), mapped to `auth_rate_limits`.
 * `last_request` is documented as a plain epoch-ms number ("bigint"), not a
 * `Date`, so it keeps the repo's plain-INTEGER convention.
 */
export const authRateLimits = sqliteTable(
  'auth_rate_limits',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    lastRequest: integer('last_request').notNull(),
  },
  (t) => [uniqueIndex('uq_auth_rate_limits__key').on(t.key)],
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
    /**
     * Phase 10 admin suspension (docs/security.md — INTERNAL_ADMIN
     * governance). Deliberately NOT a third `status` CHECK value: SQLite
     * cannot ALTER a CHECK constraint without a full create-new/copy/swap
     * table rebuild (see migration-safety skill), and suspension is
     * orthogonal to the active/deleted lifecycle (a suspended org is still
     * `active` — it just loses feed/digest access while under review).
     * Additive nullable column instead: null = not suspended, a timestamp =
     * suspended since. `requireOrganization` (apps/worker) 403s when set;
     * `listOrgsWithDigestEnabled` excludes it.
     */
    suspendedAt: integer('suspended_at'),
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

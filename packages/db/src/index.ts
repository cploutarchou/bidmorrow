/**
 * @bidmorrow/db — Drizzle schema + repository layer.
 *
 * Phase 3: the D1 schema lives in ./schema (docs/data-model.md); repository
 * functions arrive with their consuming features. The tenancy contract below
 * is foundational and applies to every repository function.
 */

export const PACKAGE = '@bidmorrow/db';

export * as schema from './schema';
export * from './schema';

export { createDb } from './client';
export type { Db } from './client';
export { newId } from './id';

// Shared repository infrastructure (pagination, batching, typed errors).
export * from './repositories/shared';
export * from './repositories/errors';

// Global repositories (no organizationId by design; see the header comment
// in each file): tender corpus, ingestion ops, global feature flags.
export * from './repositories/tender-corpus';
export * from './repositories/ingestion';
export * from './repositories/ops-global';
export * from './repositories/retention';
// Deleted-organization hard-purge (Phase 11 stage A): cross-tenant by
// design, reachable only from the daily retention cron path — see the file
// header in repositories/org-purge.ts for the full rationale.
export * from './repositories/org-purge';

// ADMIN repository (Phase 10 stage A): documented cross-tenant reads,
// reachable ONLY from /api/admin/* — see the file header in
// repositories/admin.ts for the full rationale and the tenant-isolation
// contract test exemption that enforces this boundary stays honest.
export * from './repositories/admin';

// Tenant-scoped repositories (every function REQUIRES organizationId per
// the TENANT RULE below; the two nullable-org ledgers take an explicit
// `OrganizationId | null`).
export * from './repositories/identity';
export * from './repositories/company';
export * from './repositories/matching';
export * from './repositories/engagement';
export * from './repositories/billing';
export * from './repositories/ops';
export * from './repositories/export';

/**
 * Context handed to every repository function by the composition root
 * (`apps/worker`): the schema-typed Drizzle D1 client from `createDb`.
 */
export interface RepositoryContext {
  readonly db: import('./client').Db;
}

/**
 * TENANT RULE (docs/security.md C6): every organization-scoped repository
 * function MUST take an argument object that requires `organizationId`, and
 * every query it issues MUST filter on it. Wrapping a repository function's
 * argument type in `TenantScoped` makes that requirement explicit and
 * grep-auditable — an argument type that cannot supply `organizationId`
 * does not compile.
 *
 * The organization id always derives from the caller's session membership,
 * never from client input.
 */
export type TenantScoped<A extends { organizationId: string }> = A;

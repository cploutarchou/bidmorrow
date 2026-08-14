/**
 * @bidmorrow/db — Drizzle schema + repository layer.
 *
 * Phase 2 skeleton: the D1 schema and the repository functions arrive in
 * Phase 3. What is foundational now is the tenancy contract below.
 */

export const PACKAGE = '@bidmorrow/db';

/**
 * Context handed to every repository function by the composition root
 * (`apps/worker`). `db` becomes the typed Drizzle D1 client in Phase 3; it
 * is `unknown` here so nothing can be built against an untyped client by
 * accident.
 */
export interface RepositoryContext {
  readonly db: unknown;
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

/**
 * @bidmorrow/auth — Better Auth configuration + middleware (ADR-0002).
 *
 * Phase 2 skeleton: this package owns only the role vocabulary for now.
 * Better Auth wiring, the Drizzle adapter, and middleware arrive in the auth
 * phase (Phase 4) together with the CLI-generated schema.
 */

export const PACKAGE = '@bidmorrow/auth';

/**
 * Organization membership roles (docs/data-model.md `organization_members.role`).
 */
export const ORGANIZATION_ROLES = ['ORGANIZATION_OWNER', 'MEMBER'] as const;
export type Role = (typeof ORGANIZATION_ROLES)[number];

/**
 * INTERNAL_ADMIN is deliberately NOT part of {@link Role} and is never stored
 * as a membership row (docs/data-model.md §1): it is an app-level flag
 * resolved per request from the ADMIN_EMAILS allowlist held in configuration,
 * checked server-side and audited. This type exists so code can name the
 * concept without ever making it assignable to a membership role.
 */
export type InternalAdmin = 'INTERNAL_ADMIN';

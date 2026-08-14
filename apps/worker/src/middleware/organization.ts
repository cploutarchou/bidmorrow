/**
 * Organization context middleware (Phase 4 stage B, docs/security.md C6 /
 * ADR-0007): resolves the caller's organization + role EXCLUSIVELY from
 * `organization_members` via the session's user id — never from any
 * client-supplied `organizationId`/role in the query string, body, or
 * headers. Must run after `requireSession`.
 *
 * V1 rule: a user belongs to at most one active organization
 * (docs/product-scope.md). No organization → 403 (not 404 — the caller is
 * authenticated, just not onboarded yet).
 */
import type { MiddlewareHandler } from 'hono';
import { createDb, getOrganizationsForUser, type OrganizationMemberRole } from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';

import type { AppBindings } from '../env';

export const requireOrganization: MiddlewareHandler<AppBindings> = async (c, next) => {
  const session = c.get('session');
  if (session === undefined) {
    // Defensive: this middleware is only ever wired after requireSession.
    return c.json({ error: 'unauthenticated' }, 401);
  }
  const db = createDb(c.env.DB);
  const page = await getOrganizationsForUser(db, { userId: session.user.id, limit: 2 });
  const first = page.items[0];
  if (first === undefined) {
    return c.json({ error: 'no_organization' }, 403);
  }
  c.set('organizationId', toOrganizationId(first.organization.id));
  // The DB CHECK constrains `role` to the two valid values; Drizzle's
  // column type is plain `text`, so the cast is the enum boundary.
  c.set('role', first.membership.role as OrganizationMemberRole);
  await next();
};

/** Route-level role guard; must run after `requireOrganization`. */
export function requireRole(role: OrganizationMemberRole): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (c.get('role') !== role) {
      return c.json({ error: 'forbidden' }, 403);
    }
    await next();
  };
}

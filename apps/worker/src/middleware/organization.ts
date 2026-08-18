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
import {
  createDb,
  getFirstOrganizationForUserAnyStatus,
  type OrganizationMemberRole,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';

import type { AppBindings } from '../env';

export const requireOrganization: MiddlewareHandler<AppBindings> = async (c, next) => {
  const session = c.get('session');
  if (session === undefined) {
    // Defensive: this middleware is only ever wired after requireSession.
    return c.json({ error: 'unauthenticated' }, 401);
  }
  const db = createDb(c.env.DB);
  // Phase 11 stage A: resolves the caller's membership regardless of the
  // organization's `status`, so a self-deleted org's members get a
  // distinct `organization_deleted` response instead of the
  // onboarding-shaped `no_organization` (docs/privacy.md commitment 2) —
  // `getOrganizationsForUser` (the every-other-route default) deliberately
  // filters to `active` only and would make the two cases indistinguishable.
  const first = await getFirstOrganizationForUserAnyStatus(db, session.user.id);
  if (first === null) {
    return c.json({ error: 'no_organization' }, 403);
  }
  if (first.organization.status === 'deleted') {
    return c.json({ error: 'organization_deleted' }, 403);
  }
  // Phase 10 admin suspension (docs/security.md — INTERNAL_ADMIN
  // governance): a suspended org keeps its `active` status (retention/
  // deletion lifecycle is untouched) but loses every tenant-scoped API
  // route while under review — feed/digest access blocked at the source.
  if (first.organization.suspendedAt !== null) {
    return c.json({ error: 'organization_suspended' }, 403);
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

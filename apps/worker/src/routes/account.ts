/**
 * `DELETE /api/account` — self-service account deletion (Phase 4 stage B,
 * docs/security.md auth policy).
 *
 * V1 has no organization-transfer or organization-deletion UI (documented
 * gap — see ADR-0007 consequences), so a user who is the sole OWNER of an
 * organization cannot delete their account until that's built: 409
 * `transfer_or_delete_organization_first`. Every other membership (MEMBER
 * rows, or co-owned orgs once that ever exists) is removed first so the
 * FK from `organization_members.user_id -> users.id` never blocks the
 * Better Auth user deletion that follows.
 */
import { Hono } from 'hono';
import {
  countOrganizationOwners,
  createDb,
  getOrganizationsForUser,
  insertAuditEvent,
  removeOrganizationMember,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';

import { createRequestAuth } from '../auth-instance';
import type { AppBindings } from '../env';
import { requireSession } from '../middleware/session';

export const accountRoutes = new Hono<AppBindings>();

accountRoutes.use('*', requireSession);

accountRoutes.delete('/', async (c) => {
  const session = c.get('session');
  if (session === undefined) return c.json({ error: 'unauthenticated' }, 401);

  const db = createDb(c.env.DB);
  const memberships = await getOrganizationsForUser(db, { userId: session.user.id, limit: 10 });

  for (const { organization, membership } of memberships.items) {
    if (membership.role === 'ORGANIZATION_OWNER') {
      const ownerCount = await countOrganizationOwners(db, toOrganizationId(organization.id));
      if (ownerCount <= 1) {
        return c.json({ error: 'transfer_or_delete_organization_first' }, 409);
      }
    }
  }

  for (const { organization } of memberships.items) {
    await removeOrganizationMember(db, toOrganizationId(organization.id), session.user.id);
  }

  await insertAuditEvent(db, {
    actorType: 'user',
    actorId: session.user.id,
    organizationId: null,
    action: 'account.deleted',
    targetType: 'user',
    targetId: session.user.id,
    occurredAt: Date.now(),
  });

  // Deletes the users/auth_accounts/auth_sessions rows (verified from
  // installed source, `internal-adapter.mjs` `deleteUser`) and clears the
  // session cookie; requires `user.deleteUser.enabled` (packages/auth).
  const auth = createRequestAuth(c.env, c.get('logger'));
  await auth.api.deleteUser({ headers: c.req.raw.headers, body: {} });

  return c.body(null, 204);
});

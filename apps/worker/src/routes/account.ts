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
  addOrganizationMember,
  countOrganizationOwners,
  createDb,
  getOrganizationsForUser,
  insertAuditEvent,
  removeOrganizationMember,
  type OrganizationForUser,
  type OrganizationMemberRole,
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

  // Fetch every membership, not just the first page: a fixed page cap here
  // would let an OWNER row past that cap silently escape the sole-OWNER
  // guard below, letting the account (and its organization) be deleted out
  // from under co-members.
  const memberships: OrganizationForUser[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await getOrganizationsForUser(
      db,
      cursor === undefined
        ? { userId: session.user.id, limit: 100 }
        : { userId: session.user.id, limit: 100, cursor },
    );
    memberships.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }

  for (const { organization, membership } of memberships) {
    if (membership.role === 'ORGANIZATION_OWNER') {
      const ownerCount = await countOrganizationOwners(db, toOrganizationId(organization.id));
      if (ownerCount <= 1) {
        return c.json({ error: 'transfer_or_delete_organization_first' }, 409);
      }
    }
  }

  // FK-driven ordering (SEC-P4-04 / P4-R-03): organization_members.user_id
  // references users.id, so every membership must be removed before Better
  // Auth's deleteUser can succeed. The removed rows are captured so a
  // deleteUser failure can be compensated (re-inserted) instead of leaving
  // the user silently dropped from every organization while their auth
  // account still exists.
  for (const { organization } of memberships) {
    await removeOrganizationMember(db, toOrganizationId(organization.id), session.user.id);
  }

  // Deletes the users/auth_accounts/auth_sessions rows (verified from
  // installed source, `internal-adapter.mjs` `deleteUser`) and clears the
  // session cookie; requires `user.deleteUser.enabled` (packages/auth).
  const auth = createRequestAuth(c.env, c.get('logger'));
  try {
    await auth.api.deleteUser({ headers: c.req.raw.headers, body: {} });
  } catch (cause) {
    // Compensation: put the removed memberships back so the account isn't
    // left half-deleted (still a valid auth user, but orphaned from every
    // organization it belonged to).
    for (const { organization, membership } of memberships) {
      // membership.role is a plain `text` column value at the type level
      // (its allowed values are enforced by a DB CHECK constraint, not
      // Drizzle's type system) — the cast reflects a value we ourselves
      // just read back from that constrained column.
      await addOrganizationMember(db, toOrganizationId(organization.id), {
        userId: session.user.id,
        role: membership.role as OrganizationMemberRole,
      });
    }
    c.get('logger').error('account deletion failed after membership removal; compensated', {
      cause,
      user_id: session.user.id,
    });
    return c.json({ error: 'account_deletion_failed' }, 500);
  }

  // Audit only after deleteUser has actually succeeded — an audit row for a
  // deletion that failed (and was compensated above) would be a false
  // record. `actorId` carries no FK to `users` (docs/data-model.md §10), so
  // inserting after the user row is gone is safe.
  await insertAuditEvent(db, {
    actorType: 'user',
    actorId: session.user.id,
    organizationId: null,
    action: 'account.deleted',
    targetType: 'user',
    targetId: session.user.id,
    occurredAt: Date.now(),
  });

  return c.body(null, 204);
});

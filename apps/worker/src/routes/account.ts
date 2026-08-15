/**
 * `DELETE /api/account` — self-service account deletion (Phase 4 stage B,
 * docs/security.md auth policy).
 *
 * V1 has no organization-transfer UI (documented gap — see ADR-0007
 * consequences), so a user who is the sole OWNER of an ACTIVE organization
 * cannot delete their account until they delete the organization first
 * (`DELETE /api/org`, Phase 11 stage A): 409
 * `transfer_or_delete_organization_first`. An org that is ALREADY
 * `status = 'deleted'` does not trigger this guard — there is nothing left
 * to orphan, and blocking the deletion would strand the account forever
 * once its only organization is gone.
 *
 * Every membership — in EVERY organization, regardless of `status` — is
 * removed before Better Auth's `deleteUser` runs, so the FK from
 * `organization_members.user_id -> users.id` never blocks it. This uses
 * `getAllOrganizationsForUser` (not the active-only `getOrganizationsForUser`
 * every other route uses): a membership row in an already soft-deleted org
 * carries the exact same FK and must be cleared too (Phase 11 stage A fix —
 * previously the active-only filter silently skipped it, so a sole owner
 * account-deleting themselves after `DELETE /api/org` would 500 on the
 * leftover membership row's FK).
 *
 * Phase 11 stage A also fixes a second FK edge: `saved_tenders.saved_by_
 * user_id` / `ignored_tenders.ignored_by_user_id` / `customer_feedback.
 * user_id` are ORG rows a departing MEMBER (non-owner) may have authored in
 * an org they remain a member of after this user leaves. Those columns are
 * nullable (migration 0005) precisely so `nullifyUserAuthorship` can clear
 * this user's attribution on them WITHOUT deleting the org's data, before
 * the membership itself is removed.
 */
import { Hono } from 'hono';
import {
  addOrganizationMember,
  countOrganizationOwners,
  createDb,
  getAllOrganizationsForUser,
  insertAuditEvent,
  nullifyOrganizationCreator,
  nullifyUserAuthorship,
  removeOrganizationMember,
  type NullifyUserAuthorshipCounts,
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

  // Fetch every membership, not just the first page, in EVERY organization
  // status (see module doc): a fixed page cap here would let an OWNER row
  // past that cap silently escape the sole-OWNER guard below, letting the
  // account (and its organization) be deleted out from under co-members.
  const memberships: OrganizationForUser[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await getAllOrganizationsForUser(
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
    // Only an ACTIVE organization's sole ownership blocks deletion — a
    // `deleted` organization has nothing left to orphan (see module doc).
    if (organization.status === 'active' && membership.role === 'ORGANIZATION_OWNER') {
      const ownerCount = await countOrganizationOwners(db, toOrganizationId(organization.id));
      if (ownerCount <= 1) {
        return c.json({ error: 'transfer_or_delete_organization_first' }, 409);
      }
    }
  }

  // FK safety, part 1 (Phase 11 stage A): clear this user's authorship
  // attribution on org-owned rows (saved/ignored/feedback) BEFORE removing
  // memberships — see module doc. Best-effort counts logged, not returned
  // to the caller (internal bookkeeping only).
  const nullified: NullifyUserAuthorshipCounts = await nullifyUserAuthorship(
    db,
    session.user.id,
    memberships.map(({ organization }) => toOrganizationId(organization.id)),
  );
  // FK safety, part 1b (Phase 11 stage A, migration 0006 — see identity.ts's
  // doc on `nullifyOrganizationCreator`): organizations are never
  // hard-deleted, so the creator FK must be cleared too, for every org this
  // user created regardless of membership/status.
  await nullifyOrganizationCreator(db, session.user.id);

  // FK safety, part 2 (SEC-P4-04 / P4-R-03): organization_members.user_id
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
    // Not compensated: the authorship nulling above (`nullified`). Restoring
    // it exactly would require re-identifying which now-anonymous rows were
    // this user's, which the nulled state itself no longer records.
    // Accepted: it is a lost attribution label on the user's own rows, not
    // a lost row or a lost membership — a retried deletion is still fully
    // idempotent (nullifyUserAuthorship finds nothing left to null).
    c.get('logger').error('account deletion failed after membership removal; compensated', {
      cause,
      user_id: session.user.id,
      authorship_nullified_uncompensated: nullified,
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

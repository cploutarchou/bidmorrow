/**
 * Identity & tenancy repository — organizations and memberships
 * (docs/data-model.md §1, docs/security.md C6).
 *
 * `getOrganizationsForUser` is the tenancy BOOTSTRAP: it is the one read
 * that starts from a user id (session) instead of an organization id,
 * because it is how the request layer discovers which organizations a user
 * may act in. Every row it returns is constrained through the caller's own
 * `organization_members` row.
 */
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import type { OrganizationId } from '@bidmorrow/domain';

import type { Db } from '../client';
import { newId } from '../id';
import { organizationMembers, organizations, users } from '../schema/identity';
import { normalizeLimit, toPage, type Page, type Pagination } from './shared';

export type Organization = typeof organizations.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;

export type OrganizationMemberRole = 'ORGANIZATION_OWNER' | 'MEMBER';

export interface CreateOrganizationArgs {
  name: string;
  /** Becomes `created_by_user_id` and the ORGANIZATION_OWNER member. */
  createdByUserId: string;
}

/**
 * Creates an organization together with its creator's ORGANIZATION_OWNER
 * membership, atomically (single D1 batch = one SQL transaction).
 */
export async function createOrganization(
  db: Db,
  args: CreateOrganizationArgs,
): Promise<{ organization: Organization; membership: OrganizationMember }> {
  const now = Date.now();
  const organization: Organization = {
    id: newId(now),
    name: args.name,
    status: 'active',
    createdByUserId: args.createdByUserId,
    suspendedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const membership: OrganizationMember = {
    id: newId(now),
    organizationId: organization.id,
    userId: args.createdByUserId,
    role: 'ORGANIZATION_OWNER',
    createdAt: now,
    updatedAt: now,
  };
  await db.batch([
    db.insert(organizations).values(organization),
    db.insert(organizationMembers).values(membership),
  ]);
  return { organization, membership };
}

export interface OrganizationForUser {
  organization: Organization;
  /** The caller's own membership row in that organization. */
  membership: OrganizationMember;
}

/**
 * Lists the ACTIVE organizations a user belongs to, via the
 * `organization_members` join (tenancy bootstrap — see module doc).
 * Ordered by organization id ascending (creation order); cursor = last
 * organization id.
 */
export async function getOrganizationsForUser(
  db: Db,
  args: { userId: string } & Pagination,
): Promise<Page<OrganizationForUser>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [
    eq(organizationMembers.userId, args.userId),
    eq(organizations.status, 'active'),
  ];
  if (args.cursor !== undefined) {
    conditions.push(gt(organizations.id, args.cursor));
  }
  const rows = await db
    .select({ organization: organizations, membership: organizationMembers })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(...conditions))
    .orderBy(asc(organizations.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.organization.id);
}

/**
 * The caller's first membership + organization row, REGARDLESS of the
 * organization's `status` — the tenancy-bootstrap counterpart to
 * `getOrganizationsForUser` (which deliberately filters to `active` for
 * every normal request path). Used only where an already-non-active org
 * must still be distinguishable from "no organization at all":
 * `middleware/organization.ts` (so a deleted org's members see
 * `organization_deleted`, not the onboarding-shaped `no_organization`) and
 * `routes/account.ts` (so account deletion can find and clean up
 * memberships in an org that was already soft-deleted, which
 * `getOrganizationsForUser`'s active-only filter would otherwise hide from
 * the FK-safety sweep — see that file's module doc).
 */
export async function getFirstOrganizationForUserAnyStatus(
  db: Db,
  userId: string,
): Promise<OrganizationForUser | null> {
  const rows = await db
    .select({ organization: organizations, membership: organizationMembers })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizations.id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * SET NULLs `organizations.created_by_user_id` for every organization this
 * user created, in ANY `status` — the account-deletion counterpart to
 * `engagement.ts`'s `nullifyUserAuthorship`, for the one more FK to `users`
 * a departing user can carry: `organizations` rows are NEVER hard-deleted
 * (see `tombstoneOrganization`'s doc), so without this, the creator of ANY
 * org — even a deleted, purged one — could never delete their own account
 * (migration 0006). Called by `routes/account.ts` before removing
 * memberships / calling Better Auth's `deleteUser`.
 */
export async function nullifyOrganizationCreator(db: Db, userId: string): Promise<number> {
  const updated = await db
    .update(organizations)
    .set({ createdByUserId: null, updatedAt: Date.now() })
    .where(eq(organizations.createdByUserId, userId))
    .returning({ id: organizations.id });
  return updated.length;
}

/**
 * Every membership a user holds, in ANY organization `status` (paginated,
 * caller accumulates pages) — the account-deletion enumeration
 * (`routes/account.ts`) needs this, not `getOrganizationsForUser`'s
 * active-only view: a membership row in an already-deleted org still holds
 * an `organization_members.user_id -> users.id` FK that must be removed
 * before Better Auth's `deleteUser` can succeed, exactly like an active
 * org's membership.
 */
export async function getAllOrganizationsForUser(
  db: Db,
  args: { userId: string } & Pagination,
): Promise<Page<OrganizationForUser>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [eq(organizationMembers.userId, args.userId)];
  if (args.cursor !== undefined) {
    conditions.push(gt(organizations.id, args.cursor));
  }
  const rows = await db
    .select({ organization: organizations, membership: organizationMembers })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(...conditions))
    .orderBy(asc(organizations.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => last.organization.id);
}

export interface AddOrganizationMemberArgs {
  userId: string;
  role: OrganizationMemberRole;
}

/**
 * Adds a membership row for an existing organization. V1 ships no
 * invitation UI (ADR-0007) — this exists for the OWNER-created org
 * bootstrap path and for test seeding of MEMBER rows; a full invite flow is
 * out of V1 scope (docs/product-scope.md).
 */
export async function addOrganizationMember(
  db: Db,
  organizationId: OrganizationId,
  args: AddOrganizationMemberArgs,
): Promise<OrganizationMember> {
  const now = Date.now();
  const rows = await db
    .insert(organizationMembers)
    .values({
      id: newId(now),
      organizationId,
      userId: args.userId,
      role: args.role,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error('addOrganizationMember: insert returned no row');
  }
  return row;
}

/**
 * Removes a single user's membership from an organization (double-scoped by
 * organizationId AND userId). Returns false when no such membership existed.
 */
export async function removeOrganizationMember(
  db: Db,
  organizationId: OrganizationId,
  userId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .returning({ id: organizationMembers.id });
  return deleted.length > 0;
}

/**
 * Counts ORGANIZATION_OWNER memberships for an organization. Used to gate
 * account deletion (docs/security.md C6): V1 always creates exactly one
 * owner per organization and has no ownership-transfer UI, so any OWNER
 * membership currently means "sole owner" — this function exists so the
 * check is explicit and survives a future multi-owner feature without
 * silently becoming wrong.
 */
export async function countOrganizationOwners(
  db: Db,
  organizationId: OrganizationId,
): Promise<number> {
  const rows = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, 'ORGANIZATION_OWNER'),
      ),
    );
  return rows.length;
}

/** The organization row itself (name, status) — null when it does not exist. */
export async function getOrganization(
  db: Db,
  organizationId: OrganizationId,
): Promise<Organization | null> {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Every member's email address for an organization (digest recipient list —
 * docs/product-scope.md §7: V1 ships no invitation UI, so this is every user
 * with an `organization_members` row, owner or not). Emails only — never
 * `users.name` or other PII beyond what a "To:" header needs.
 */
export async function listOrganizationMemberEmails(
  db: Db,
  organizationId: OrganizationId,
): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId));
  return rows.map((row) => row.email);
}

/**
 * INTERNAL_ADMIN governance (Phase 10 stage A): sets `suspended_at`. Reached
 * only from `/api/admin/organizations/:id/suspend` — see
 * `packages/db/src/schema/identity.ts`'s doc comment on the column for why
 * this is a nullable timestamp rather than a third `status` value.
 * Idempotent: returns the existing row unchanged when already suspended.
 */
export async function suspendOrganization(
  db: Db,
  organizationId: OrganizationId,
): Promise<Organization | null> {
  const rows = await db
    .update(organizations)
    .set({ suspendedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(organizations.id, organizationId), eq(organizations.status, 'active')))
    .returning();
  return rows[0] ?? null;
}

/** Inverse of `suspendOrganization`. Idempotent: returns null when not currently suspended. */
export async function unsuspendOrganization(
  db: Db,
  organizationId: OrganizationId,
): Promise<Organization | null> {
  const rows = await db
    .update(organizations)
    .set({ suspendedAt: null, updatedAt: Date.now() })
    .where(and(eq(organizations.id, organizationId), eq(organizations.status, 'active')))
    .returning();
  return rows[0] ?? null;
}

/**
 * Soft-deletes an organization (`status = 'deleted'`), gating all access
 * while the retention purge job hard-deletes owned rows
 * (docs/data-model.md §11). Idempotent: returns false when the
 * organization was already deleted (or does not exist).
 */
export async function softDeleteOrganization(
  db: Db,
  organizationId: OrganizationId,
): Promise<boolean> {
  const updated = await db
    .update(organizations)
    .set({ status: 'deleted', updatedAt: Date.now() })
    .where(and(eq(organizations.id, organizationId), eq(organizations.status, 'active')))
    .returning({ id: organizations.id });
  return updated.length > 0;
}

/** Tombstone name prefix (docs/data-model.md §11 org-purge reconciliation, PII minimization). */
const TOMBSTONE_NAME_PREFIX = 'deleted-';

/**
 * Organizations eligible for hard purge: `status = 'deleted'`, older than
 * `graceDays` (measured off `updated_at`, set by `softDeleteOrganization`),
 * and not already tombstoned (`name` does not carry the `deleted-<id>`
 * prefix `purgeDeletedOrganizations` writes in its final step) — that
 * name-prefix check is what makes repeated cron runs idempotent without a
 * dedicated "purged_at" column: once an org's owned rows are gone and its
 * name is tombstoned, it is permanently excluded from every future scan.
 * Bounded by `limit`; deterministic order (ascending id) for steady
 * progress across runs.
 */
export async function listOrganizationsPendingPurge(
  db: Db,
  args: { graceDays: number; limit: number; now?: number },
): Promise<Organization[]> {
  const now = args.now ?? Date.now();
  const cutoff = now - args.graceDays * 86_400_000;
  const rows = await db
    .select()
    .from(organizations)
    .where(
      and(
        eq(organizations.status, 'deleted'),
        lte(organizations.updatedAt, cutoff),
        sql`${organizations.name} NOT LIKE ${`${TOMBSTONE_NAME_PREFIX}%`}`,
      ),
    )
    .orderBy(asc(organizations.id))
    .limit(args.limit);
  return rows;
}

/**
 * Final step of `purgeDeletedOrganizations` (packages/procurement `purge.ts`
 * composes this with the tenant-table cascade): replaces the organization's
 * `name` with a tombstone (`deleted-<id>`) — PII minimization (an org name
 * may identify a sole trader, docs/privacy.md data inventory) — while
 * KEEPING the `organizations` row itself. The row is kept, never hard-
 * deleted, because `subscriptions.organization_id` (billing/legal record,
 * never purged) and `audit_events.organization_id` /
 * `billing_events.organization_id` (append-only ledgers, never purged) all
 * carry a FK to it; deleting the row would either violate those FKs or
 * require nulling ledger columns that must stay attributable for security/
 * legal retention. `status` stays `deleted` (already set).
 */
export async function tombstoneOrganization(db: Db, organizationId: OrganizationId): Promise<void> {
  await db
    .update(organizations)
    .set({ name: `${TOMBSTONE_NAME_PREFIX}${organizationId}`, updatedAt: Date.now() })
    .where(eq(organizations.id, organizationId));
}

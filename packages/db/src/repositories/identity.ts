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
import { and, asc, eq, gt } from 'drizzle-orm';
import type { OrganizationId } from '@bidmorrow/domain';

import type { Db } from '../client';
import { newId } from '../id';
import { organizationMembers, organizations } from '../schema/identity';
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

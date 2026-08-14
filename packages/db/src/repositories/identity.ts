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

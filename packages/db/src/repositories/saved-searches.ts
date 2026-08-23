/**
 * Saved searches — named, reusable feed filter sets (migration 0010).
 *
 * Every function REQUIRES `organizationId` as its first argument after `db`
 * and constrains every statement on it (docs/security.md C6). A saved search
 * belongs to the workspace, not to the person who created it, so there is
 * deliberately no per-user filter here: `createdByUserId` is authorship for
 * the audit trail, never a visibility scope.
 *
 * Cap: 50 per organization — violations throw `CapExceededError`. The rail
 * is a list a human scans, and an unbounded one would also make the feed's
 * per-load count query unbounded.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { OrganizationId } from '@bidmorrow/domain';

import type { Db } from '../client';
import { newId } from '../id';
import { savedSearches } from '../schema/company';
import { CapExceededError, DuplicateSavedSearchError } from './errors';

export type SavedSearch = typeof savedSearches.$inferSelect;

export const SAVED_SEARCHES_CAP = 50;

export async function listSavedSearches(
  db: Db,
  organizationId: OrganizationId,
): Promise<SavedSearch[]> {
  return db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.organizationId, organizationId))
    .orderBy(asc(savedSearches.name));
}

export interface CreateSavedSearchArgs {
  readonly name: string;
  readonly tab: string;
  /** Already-validated filter object; serialized here, never at the call site. */
  readonly filters: Record<string, string>;
  readonly createdByUserId: string | null;
}

/**
 * @throws CapExceededError when the organization already holds the maximum.
 * @throws DuplicateSavedSearchError when the name is already taken.
 *
 * The duplicate check is an explicit SELECT rather than a catch on the
 * unique index's error: matching a driver's constraint-violation message is
 * a string comparison that breaks silently on a driver upgrade, and the
 * failure mode there is a 500 where the user should have been told the name
 * was taken. The index remains as the real guarantee — this single-writer
 * check-then-insert is a nicer error, not the invariant.
 */
export async function createSavedSearch(
  db: Db,
  organizationId: OrganizationId,
  args: CreateSavedSearchArgs,
): Promise<SavedSearch> {
  const existing = await db
    .select({ id: savedSearches.id, name: savedSearches.name })
    .from(savedSearches)
    .where(eq(savedSearches.organizationId, organizationId));
  if (existing.length >= SAVED_SEARCHES_CAP) {
    throw new CapExceededError('saved_searches', SAVED_SEARCHES_CAP, existing.length + 1);
  }
  if (existing.some((row) => row.name === args.name)) {
    throw new DuplicateSavedSearchError(organizationId, args.name);
  }

  const now = Date.now();
  const row: SavedSearch = {
    id: newId(),
    organizationId,
    createdByUserId: args.createdByUserId,
    name: args.name,
    tab: args.tab,
    filtersJson: JSON.stringify(args.filters),
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(savedSearches).values(row);
  return row;
}

/**
 * Returns false when nothing matched, which for an org-scoped delete means
 * either "already gone" or "belongs to another organization" — the caller
 * must not distinguish those in its response, or the endpoint becomes an
 * existence oracle for other tenants' ids.
 */
export async function deleteSavedSearch(
  db: Db,
  organizationId: OrganizationId,
  id: string,
): Promise<boolean> {
  const result = await db
    .delete(savedSearches)
    .where(and(eq(savedSearches.organizationId, organizationId), eq(savedSearches.id, id)))
    .returning({ id: savedSearches.id });
  return result.length > 0;
}

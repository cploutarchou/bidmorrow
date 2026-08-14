/**
 * Shared helpers for the D1 repository integration tests.
 *
 * Each test file gets its own isolated local D1 database (vitest-pool-workers
 * isolated storage) with all migrations applied by the setup file, so tests
 * never see each other's rows.
 *
 * All timestamps are FIXED constants — repositories that accept a time
 * parameter (`startedAt`, `finishedAt`, `retrievedAt`, `fetchedAt`,
 * `asOfMs`) get these injected so assertions are deterministic.
 */
import { env } from 'cloudflare:workers';
import { organizationId, type OrganizationId } from '@bidmorrow/domain';

import { createDb, type Db } from '../client';
import { newId } from '../id';
import { users } from '../schema/identity';
import { createOrganization } from '../repositories/identity';

/** Fixed reference instant: 2026-08-01T00:00:00Z. */
export const T0 = Date.parse('2026-08-01T00:00:00Z');

export const MS_PER_DAY = 86_400_000;

/** Schema-typed Drizzle client over the test D1 binding. */
export function testDb(): Db {
  return createDb(env.DB);
}

/**
 * vitest-pool-workers 0.21 gives each test FILE its own database, but tests
 * within a file share it. Rows with unique natural keys (users.email) must
 * therefore differ per call — this counter keeps them deterministic.
 */
let uniqueSeq = 0;

/** Deterministic per-call unique email (users.email is unique). */
export function uniqueEmail(prefix = 'user'): string {
  uniqueSeq += 1;
  return `${prefix}-${uniqueSeq}@example.com`;
}

/**
 * Inserts a placeholder `users` row (FK target for organizations,
 * memberships, saved/ignored tenders). Phase-3 schema has no user
 * repository yet — Better Auth owns user writes in Phase 4 — so tests seed
 * the row directly.
 */
export async function insertTestUser(db: Db, email = uniqueEmail()): Promise<string> {
  const id = newId(T0);
  await db.insert(users).values({
    id,
    email,
    emailVerified: 1,
    name: 'Test User',
    createdAt: T0,
    updatedAt: T0,
  });
  return id;
}

/** Creates a user + organization (with owner membership) and returns the branded org id. */
export async function insertTestOrganization(
  db: Db,
  name = 'Acme Consulting',
): Promise<{ orgId: OrganizationId; userId: string }> {
  const userId = await insertTestUser(db);
  const { organization } = await createOrganization(db, { name, createdByUserId: userId });
  return { orgId: organizationId(organization.id), userId };
}

/**
 * Digest recipient selection against real D1 (workerd).
 *
 * Exists because of SEC review finding A-3: `listOrganizationMemberEmails`
 * gained an `email_verified` predicate (F-09) that nothing exercised, so
 * deleting it would have shipped green — which is precisely the failure mode
 * the filter exists to prevent. It is the ONLY query that decides who
 * receives a digest.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import { newId } from '../id';
import { users } from '../schema/identity';
import { insertTestOrganization, testDb } from '../test/helpers';
import { addOrganizationMember, listOrganizationMemberEmails } from './identity';

describe('listOrganizationMemberEmails', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  async function addMember(
    orgId: Parameters<typeof addOrganizationMember>[1],
    args: { email: string; emailVerified: boolean },
  ): Promise<void> {
    const userId = newId(Date.now());
    await db.insert(users).values({
      id: userId,
      email: args.email,
      emailVerified: args.emailVerified,
      name: 'Member',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await addOrganizationMember(db, orgId, { userId, role: 'MEMBER' });
  }

  it('returns verified members and excludes unverified ones (F-09)', async () => {
    const { orgId } = await insertTestOrganization(db);
    await addMember(orgId, { email: 'verified@example.test', emailVerified: true });
    await addMember(orgId, { email: 'unverified@example.test', emailVerified: false });

    const emails = await listOrganizationMemberEmails(db, orgId);

    expect(emails).toContain('verified@example.test');
    expect(emails).not.toContain('unverified@example.test');
  });

  it('returns an empty list when every member is unverified — never a digest send', async () => {
    const { orgId } = await insertTestOrganization(db);
    // insertTestOrganization's creator is verified, so build a fresh org whose
    // only members are unverified by flipping the creator too.
    await db.update(users).set({ emailVerified: false });
    await addMember(orgId, { email: 'also-unverified@example.test', emailVerified: false });

    expect(await listOrganizationMemberEmails(db, orgId)).toEqual([]);
  });

  it('never leaks a verified member of ANOTHER organization', async () => {
    const mine = await insertTestOrganization(db);
    const theirs = await insertTestOrganization(db);
    await addMember(theirs.orgId, { email: 'other-org@example.test', emailVerified: true });

    expect(await listOrganizationMemberEmails(db, mine.orgId)).not.toContain(
      'other-org@example.test',
    );
  });
});

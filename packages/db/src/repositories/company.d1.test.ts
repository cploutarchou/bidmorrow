/**
 * Organizations + company-bundle integration tests against real D1
 * (workerd): org creation with owner membership, profile upsert, and the
 * keyword replace-set with its 50-row cap (docs/data-model.md §1–§2).
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../client';
import { organizationMembers } from '../schema/identity';
import { insertTestOrganization, insertTestUser, testDb } from '../test/helpers';
import {
  COMPANY_KEYWORDS_CAP,
  getCompanyProfile,
  listCompanyKeywords,
  replaceCompanyKeywords,
  upsertCompanyProfile,
  type KeywordInput,
} from './company';
import { CapExceededError } from './errors';
import { createOrganization, getOrganizationsForUser } from './identity';

function positiveKeywords(count: number): KeywordInput[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'positive' as const,
    term: `keyword-${String(i).padStart(3, '0')}`,
  }));
}

describe('createOrganization', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('creates the organization together with its owner membership atomically', async () => {
    const userId = await insertTestUser(db);
    const { organization, membership } = await createOrganization(db, {
      name: 'Acme Consulting',
      createdByUserId: userId,
    });

    expect(organization).toMatchObject({
      name: 'Acme Consulting',
      status: 'active',
      createdByUserId: userId,
    });
    expect(membership).toMatchObject({
      organizationId: organization.id,
      userId,
      role: 'ORGANIZATION_OWNER',
    });

    const storedMembers = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organization.id));
    expect(storedMembers).toHaveLength(1);
    expect(storedMembers[0]).toMatchObject({ userId, role: 'ORGANIZATION_OWNER' });

    // Tenancy bootstrap resolves the org from the user's membership.
    const page = await getOrganizationsForUser(db, { userId });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.organization.id).toBe(organization.id);
    expect(page.items[0]?.membership.id).toBe(membership.id);
  });
});

describe('upsertCompanyProfile', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('inserts on first call and updates the same 1:1 row on the second', async () => {
    const { orgId } = await insertTestOrganization(db);

    const created = await upsertCompanyProfile(db, orgId, {
      displayName: 'Acme',
      description: 'IT consultancy',
      website: 'https://acme.example',
      employeeBand: '11-50',
      presetKey: 'it-services',
      onboardingCompletedAt: null,
    });
    expect(created.organizationId).toBe(orgId);

    const updated = await upsertCompanyProfile(db, orgId, {
      displayName: 'Acme Consulting Ltd',
      description: 'IT consultancy',
      website: 'https://acme.example',
      employeeBand: '51-200',
      presetKey: 'it-services',
      onboardingCompletedAt: 1_777_600_000_000,
    });
    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({
      displayName: 'Acme Consulting Ltd',
      employeeBand: '51-200',
      onboardingCompletedAt: 1_777_600_000_000,
    });

    const readBack = await getCompanyProfile(db, orgId);
    expect(readBack?.displayName).toBe('Acme Consulting Ltd');
  });
});

describe('replaceCompanyKeywords', () => {
  let db: Db;

  beforeEach(() => {
    db = testDb();
  });

  it('replaces the whole keyword set atomically', async () => {
    const { orgId } = await insertTestOrganization(db);

    await replaceCompanyKeywords(db, orgId, {
      keywords: [
        { kind: 'positive', term: 'cloud migration' },
        { kind: 'synonym', term: 'k8s', synonymGroup: 'kubernetes' },
      ],
    });
    await replaceCompanyKeywords(db, orgId, { keywords: positiveKeywords(3) });

    const page = await listCompanyKeywords(db, orgId, { limit: 100 });
    expect(page.items.map((row) => row.term).sort()).toEqual([
      'keyword-000',
      'keyword-001',
      'keyword-002',
    ]);
  });

  it('accepts exactly the 50-keyword cap', async () => {
    const { orgId } = await insertTestOrganization(db);

    await replaceCompanyKeywords(db, orgId, { keywords: positiveKeywords(COMPANY_KEYWORDS_CAP) });

    const page = await listCompanyKeywords(db, orgId, { limit: 100 });
    expect(page.items).toHaveLength(50);
  });

  it('throws CapExceededError at 51 and leaves the existing set untouched', async () => {
    const { orgId } = await insertTestOrganization(db);
    await replaceCompanyKeywords(db, orgId, { keywords: positiveKeywords(2) });

    const attempt = replaceCompanyKeywords(db, orgId, { keywords: positiveKeywords(51) });
    await expect(attempt).rejects.toThrow(CapExceededError);
    await expect(
      replaceCompanyKeywords(db, orgId, { keywords: positiveKeywords(51) }),
    ).rejects.toMatchObject({
      code: 'CAP_EXCEEDED',
      resource: 'company_keywords',
      cap: 50,
      attempted: 51,
    });

    // The cap check runs before any statement: the previous set survives.
    const page = await listCompanyKeywords(db, orgId, { limit: 100 });
    expect(page.items.map((row) => row.term).sort()).toEqual(['keyword-000', 'keyword-001']);
  });
});

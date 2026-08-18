/**
 * Tenant-isolation NEGATIVE tests (real local D1 via
 * @cloudflare/vitest-pool-workers) — docs/procedures/tenant-isolation-audit.md
 * "Test audit" section.
 *
 * Two organizations (A and B) are seeded in every test. Each test then
 * proves a cross-tenant access attempt yields NOTHING: reads scoped to A
 * never return B's rows even when B's rows exist, and writes scoped to A
 * that name B's row ids affect 0 rows. Any failure here is CRITICAL
 * (docs/security.md C6).
 */
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { organizationId, type OrganizationId } from '@bidmorrow/domain';

import { createDb, type Db } from './client';
import { newId } from './id';
import {
  getSubscription,
  insertBillingEventIfNew,
  upsertSubscriptionByStripeCustomerId,
} from './repositories/billing';
import {
  getCompanyProfile,
  getDigestPreferences,
  getMatchingPreferences,
  listCompanyKeywords,
  replaceCompanyKeywords,
  upsertCompanyProfile,
  upsertDigestPreferences,
  upsertMatchingPreferences,
} from './repositories/company';
import {
  createDigestRun,
  recordDigestRunOutcome,
  saveTender,
  unsaveTender,
  upsertCustomerFeedback,
} from './repositories/engagement';
import { createOrganization } from './repositories/identity';
import { TenantMismatchError } from './repositories/errors';
import {
  getTenderMatchWithComponents,
  insertTenderMatches,
  listFeedRows,
} from './repositories/matching';
import { billingEvents } from './schema/billing';
import { customerFeedback, digestRuns, savedTenders } from './schema/engagement';
import { users } from './schema/identity';
import { sourceSnapshots } from './schema/ingestion';
import { tenderLots, tenderNotices, tenderNoticeVersions } from './schema/tender';

const ENGINE_VERSION = '1';

interface SeededOrg {
  orgId: OrganizationId;
  userId: string;
}

async function seedUser(db: Db): Promise<string> {
  const now = Date.now();
  const id = newId(now);
  await db.insert(users).values({
    id,
    email: `${id}@example.test`,
    emailVerified: false,
    name: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  return id;
}

async function seedOrg(db: Db, name: string): Promise<SeededOrg> {
  const userId = await seedUser(db);
  const { organization } = await createOrganization(db, { name, createdByUserId: userId });
  return { orgId: organizationId(organization.id), userId };
}

/** Seeds the GLOBAL corpus chain (snapshot → notice → version → lot). */
async function seedLot(db: Db): Promise<{ lotId: string; noticeId: string }> {
  const now = Date.now();
  const snapshotId = newId(now);
  const noticeId = newId(now);
  const versionId = newId(now);
  const lotId = newId(now);
  const sourceNoticeId = `test-${noticeId}`;

  await db.insert(sourceSnapshots).values({
    id: snapshotId,
    source: 'ted',
    sourceNoticeId,
    versionNumber: 1,
    r2Key: `snapshots/${snapshotId}.xml`,
    contentHash: `hash-${snapshotId}`,
    sizeBytes: 128,
    contentType: 'application/xml',
    retainedUntilAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tenderNotices).values({
    id: noticeId,
    source: 'ted',
    sourceNoticeId,
    currentVersionId: null,
    buyerId: null,
    noticeType: 'cn-standard',
    procedureType: 'open',
    eformsSdkVersion: null,
    sourceLanguagesJson: '["ENG"]',
    sourceUrl: `https://ted.europa.eu/notice/${sourceNoticeId}`,
    publicationDate: '2026-08-01',
    retrievedAt: now,
    contentHash: `hash-${snapshotId}`,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tenderNoticeVersions).values({
    id: versionId,
    noticeId,
    versionNumber: 1,
    publicationDate: '2026-08-01',
    contentHash: `hash-${snapshotId}`,
    snapshotId,
    eformsSdkVersion: null,
    ingestionRunId: null,
    createdAt: now,
  });
  await db
    .update(tenderNotices)
    .set({ currentVersionId: versionId })
    .where(eq(tenderNotices.id, noticeId));
  await db.insert(tenderLots).values({
    id: lotId,
    noticeVersionId: versionId,
    lotNumber: 'LOT-0001',
    title: 'Isolation test lot',
    description: null,
    contractNature: 'services',
    estimatedValueAmount: null,
    estimatedValueCurrency: null,
    estimatedValueEur: null,
    valueIsDerived: 0,
    deadlineAt: null,
    createdAt: now,
  });
  return { lotId, noticeId };
}

/** Scores `lot` for `orgId` and returns the created match id. */
async function seedMatch(
  db: Db,
  orgId: OrganizationId,
  lot: { lotId: string; noticeId: string },
): Promise<string> {
  const result = await insertTenderMatches(db, orgId, {
    matches: [
      {
        lotId: lot.lotId,
        noticeId: lot.noticeId,
        engineVersion: ENGINE_VERSION,
        score: 80,
        classification: 'STRONG_MATCH',
        scoredAt: Date.now(),
        components: [
          {
            componentKey: 'cpv',
            points: 20,
            maxPoints: 25,
            status: 'MATCHED',
            explanation: 'seeded component',
          },
        ],
      },
    ],
  });
  expect(result.inserted).toBe(1);
  // The production feed path (`listFeedRows`, the query `GET /api/org/feed`
  // actually runs — P-2, docs/phase12-quality-findings.md): the freshly
  // scored match is on the `today` tab, and its id comes back as `matchId`.
  const page = await listFeedRows(db, orgId, {
    tab: 'today',
    engineVersion: ENGINE_VERSION,
    now: Date.now(),
  });
  const match = page.items.find((m) => m.lotId === lot.lotId);
  if (match === undefined) throw new Error('seedMatch: inserted match not found in own feed');
  return match.matchId;
}

const db = createDb(env.DB);

describe('company profile & preferences isolation', () => {
  it('get* scoped to A returns only A rows even when B rows exist', async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];

    await upsertCompanyProfile(db, orgA.orgId, {
      displayName: 'Alpha GmbH',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: null,
    });
    await upsertCompanyProfile(db, orgB.orgId, {
      displayName: 'Beta SARL',
      description: 'B-secret',
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: null,
    });
    await upsertMatchingPreferences(db, orgB.orgId, {
      minValueEur: 1000,
      maxValueEur: 999999,
      supportedContractNatures: ['services'],
      minimumDaysRemaining: 14,
    });
    await upsertDigestPreferences(db, orgB.orgId, {
      enabled: true,
      sendEmpty: false,
      minClassification: 'WORTH_REVIEWING',
      timezone: 'Europe/Paris',
    });

    const profileA = await getCompanyProfile(db, orgA.orgId);
    expect(profileA?.organizationId).toBe(orgA.orgId);
    expect(profileA?.displayName).toBe('Alpha GmbH');
    expect(JSON.stringify(profileA)).not.toContain('B-secret');

    // B's 1:1 preference rows exist; A's reads must see none of them.
    expect(await getMatchingPreferences(db, orgA.orgId)).toBeNull();
    expect(await getDigestPreferences(db, orgA.orgId)).toBeNull();
  });

  it('keyword lists never cross organizations, and A replacing its keywords leaves B untouched', async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];
    await replaceCompanyKeywords(db, orgB.orgId, {
      keywords: [{ kind: 'positive', term: 'b-confidential-term' }],
    });

    // A's list must not contain B's keyword even though A has none.
    const beforeA = await listCompanyKeywords(db, orgA.orgId);
    expect(beforeA.items).toHaveLength(0);

    // A replacing (delete-all + insert) must only delete A's rows.
    await replaceCompanyKeywords(db, orgA.orgId, {
      keywords: [{ kind: 'positive', term: 'a-term' }],
    });
    const afterB = await listCompanyKeywords(db, orgB.orgId);
    expect(afterB.items.map((k) => k.term)).toEqual(['b-confidential-term']);
    const afterA = await listCompanyKeywords(db, orgA.orgId);
    expect(afterA.items.map((k) => k.term)).toEqual(['a-term']);
    expect(afterA.items.every((k) => k.organizationId === orgA.orgId)).toBe(true);
  });
});

describe('tender_matches isolation', () => {
  it("A's listForFeed never returns B's tender_matches (same lot scored for both)", async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];
    const lot = await seedLot(db);
    const matchIdA = await seedMatch(db, orgA.orgId, lot);
    const matchIdB = await seedMatch(db, orgB.orgId, lot);

    const feedA = await listFeedRows(db, orgA.orgId, {
      tab: 'today',
      engineVersion: ENGINE_VERSION,
      now: Date.now(),
    });
    // Exactly A's match and nothing else — the id-set equality IS the
    // isolation assertion (FeedRow deliberately carries no organizationId).
    expect(feedA.items.map((m) => m.matchId)).toEqual([matchIdA]);
    expect(feedA.items.map((m) => m.matchId)).not.toContain(matchIdB);
  });

  it("A reading B's match by id gets null — components never leak through the parent", async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];
    const lot = await seedLot(db);
    const matchIdB = await seedMatch(db, orgB.orgId, lot);

    expect(await getTenderMatchWithComponents(db, orgA.orgId, { matchId: matchIdB })).toBeNull();
    // Sanity: the row genuinely exists for its owner.
    const own = await getTenderMatchWithComponents(db, orgB.orgId, { matchId: matchIdB });
    expect(own?.match.id).toBe(matchIdB);
    expect(own?.components.length).toBeGreaterThan(0);
  });
});

describe('cross-tenant writes affect 0 rows', () => {
  it("A unsaving B's saved tender (B's lot id, A's organizationId) deletes nothing", async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];
    const lot = await seedLot(db);
    expect(
      await saveTender(db, orgB.orgId, {
        lotId: lot.lotId,
        noticeId: lot.noticeId,
        savedByUserId: orgB.userId,
      }),
    ).toBe(true);

    expect(await unsaveTender(db, orgA.orgId, { lotId: lot.lotId })).toBe(false);

    const stillSaved = await db
      .select()
      .from(savedTenders)
      .where(and(eq(savedTenders.organizationId, orgB.orgId), eq(savedTenders.lotId, lot.lotId)));
    expect(stillSaved).toHaveLength(1);
  });

  it("A recording an outcome on B's digest run (B's row id, A's organizationId) updates nothing", async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];
    const runB = await createDigestRun(db, orgB.orgId, { digestDate: '2026-08-14' });

    const result = await recordDigestRunOutcome(db, orgA.orgId, {
      digestRunId: runB.id,
      status: 'sent',
      sentAt: Date.now(),
    });
    expect(result).toBeNull();

    const rows = await db.select().from(digestRuns).where(eq(digestRuns.id, runB.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.organizationId).toBe(orgB.orgId);
  });
});

describe('customer_feedback isolation', () => {
  it("feedback inserted by A is invisible to queries scoped to B's organizationId", async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];
    const lot = await seedLot(db);
    const matchIdA = await seedMatch(db, orgA.orgId, lot);

    const feedback = await upsertCustomerFeedback(db, orgA.orgId, {
      matchId: matchIdA,
      userId: orgA.userId,
      verdict: 'not_useful',
      reasons: ['wrong_cpv'],
      comment: 'a-private-comment',
    });
    expect(feedback.organizationId).toBe(orgA.orgId);

    // Every feedback read is organization-scoped; B's scope sees zero rows.
    const visibleToB = await db
      .select()
      .from(customerFeedback)
      .where(eq(customerFeedback.organizationId, orgB.orgId));
    expect(visibleToB).toHaveLength(0);

    const visibleToA = await db
      .select()
      .from(customerFeedback)
      .where(eq(customerFeedback.organizationId, orgA.orgId));
    expect(visibleToA.map((f) => f.id)).toEqual([feedback.id]);
  });

  it("A upserting feedback that references B's match throws TenantMismatchError (SEC-P3-01)", async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];
    const lot = await seedLot(db);
    const matchIdB = await seedMatch(db, orgB.orgId, lot);

    await expect(
      upsertCustomerFeedback(db, orgA.orgId, {
        matchId: matchIdB,
        userId: orgA.userId,
        verdict: 'useful',
      }),
    ).rejects.toBeInstanceOf(TenantMismatchError);

    // No row was written for either organization referencing B's match.
    const rows = await db
      .select()
      .from(customerFeedback)
      .where(eq(customerFeedback.matchId, matchIdB));
    expect(rows).toHaveLength(0);
  });
});

describe('foreign-key enforcement sentinel (SEC-P3-02)', () => {
  it('inserting a child row referencing a nonexistent match fails at the DB layer', async () => {
    // insertTenderMatches' concurrency handling relies on D1 enforcing FKs
    // (a failed child insert must abort the batch). Prove FKs are actually
    // on in this runtime rather than assuming it.
    const { matchComponents } = await import('./schema/matching');
    await expect(
      db.insert(matchComponents).values({
        id: newId(Date.now()),
        matchId: 'match_does_not_exist',
        componentKey: 'cpv',
        points: 10,
        maxPoints: 35,
        status: 'MATCHED',
        explanation: 'sentinel',
        createdAt: Date.now(),
      }),
    ).rejects.toThrow();
  });
});

describe('billing isolation', () => {
  it("getSubscription scoped to A never returns B's subscription", async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];
    await upsertSubscriptionByStripeCustomerId(db, orgB.orgId, {
      stripeCustomerId: `cus_B_${orgB.orgId}`,
      stripeSubscriptionId: `sub_B_${orgB.orgId}`,
      status: 'active',
      plan: 'founding',
      currentPeriodEndAt: null,
      cancelAtPeriodEnd: false,
    });

    expect(await getSubscription(db, orgA.orgId)).toBeNull();
    const subB = await getSubscription(db, orgB.orgId);
    expect(subB?.organizationId).toBe(orgB.orgId);
  });

  it("A upserting with B's stripe customer id throws TenantMismatchError and leaves B's row unchanged", async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];
    const stripeCustomerId = `cus_B_${orgB.orgId}`;
    const stripeSubscriptionId = `sub_B_${orgB.orgId}`;
    await upsertSubscriptionByStripeCustomerId(db, orgB.orgId, {
      stripeCustomerId,
      stripeSubscriptionId,
      status: 'active',
      plan: 'founding',
      currentPeriodEndAt: null,
      cancelAtPeriodEnd: false,
    });

    await expect(
      upsertSubscriptionByStripeCustomerId(db, orgA.orgId, {
        stripeCustomerId,
        stripeSubscriptionId: `sub_A_hijack_${orgA.orgId}`,
        status: 'canceled',
        plan: 'standard',
        currentPeriodEndAt: null,
        cancelAtPeriodEnd: true,
      }),
    ).rejects.toThrow(TenantMismatchError);

    const subB = await getSubscription(db, orgB.orgId);
    expect(subB?.status).toBe('active');
    expect(subB?.plan).toBe('founding');
    expect(subB?.stripeSubscriptionId).toBe(stripeSubscriptionId);
    // And A gained no subscription out of the attempt.
    expect(await getSubscription(db, orgA.orgId)).toBeNull();
  });

  it("billing_events scoped to A exclude B's events", async () => {
    const [orgA, orgB] = [await seedOrg(db, 'Org A'), await seedOrg(db, 'Org B')];
    expect(
      await insertBillingEventIfNew(db, {
        stripeEventId: `evt_B_${orgB.orgId}`,
        type: 'customer.subscription.updated',
        organizationId: orgB.orgId,
        payloadJson: '{"secret":"b-payload"}',
      }),
    ).toBe(true);

    const eventsForA = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.organizationId, orgA.orgId));
    expect(eventsForA).toHaveLength(0);

    const eventsForB = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.organizationId, orgB.orgId));
    expect(eventsForB).toHaveLength(1);
  });
});

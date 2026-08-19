/**
 * Phase 11 stage A: organization deletion, deleted-org hard purge, the
 * account-deletion FK edge fix, and the data-export endpoint — real
 * workerd + local D1 (mirrors admin.d1.test.ts's/billing.d1.test.ts's
 * setup patterns). Covers: `DELETE /api/org` (confirm-name matching,
 * OWNER-only, digest/scoring exclusion), `runOrgPurge` (pre-grace
 * untouched, post-grace hard-deletes every owned table, tombstones the
 * organization row, never touches the global tender corpus or the
 * retained ledgers), the departing-MEMBER FK edge in `DELETE /api/account`
 * (migration 0005), and `GET /api/org/export` (shape, OWNER-only,
 * cross-org isolation).
 */
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  addOrganizationMember,
  createDb,
  createDigestRun,
  createEmailDelivery,
  createOrganization,
  getOrganization,
  getOrgExportBundle,
  ignoreTender,
  insertAuditEvent,
  insertCpvCodes,
  insertDigestItems,
  insertGeographies,
  insertLots,
  insertProductEvent,
  insertSnapshotIfNewHash,
  insertSupportNote,
  insertTenderMatches,
  listOrgsEligibleForScoring,
  listOrgsWithDigestEnabled,
  markFetchRetryAbandoned,
  markFetchRetryRecovered,
  nullifyOrganizationCreator,
  replaceCompanyCapabilities,
  replaceCompanyCertifications,
  replaceCompanyCpvPreferences,
  replaceCompanyExclusions,
  replaceCompanyGeographies,
  replaceCompanyKeywords,
  saveTender,
  softDeleteOrganization,
  upsertCompanyProfile,
  upsertCustomerFeedback,
  upsertDigestPreferences,
  upsertMatchingPreferences,
  upsertFetchRetry,
  upsertNoticeWithVersion,
  upsertSubscriptionByStripeCustomerId,
  type Db,
  type TenderMatchInput,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';
import { createLogger } from '@bidmorrow/observability';
import { ENGINE_VERSION } from '@bidmorrow/matching';
import { runLedgerPurge, runOrgPurge } from '@bidmorrow/procurement';

import './index';

const BASE = 'https://bidmorrow.local';
const STATE_CHANGING_HEADERS = { origin: 'http://localhost:8787' };
const PASSWORD = 'correct horse battery staple 1!';
const SOURCE = 'ted';

let uniqueSeq = 0;
function uniqueEmail(prefix = 'org-lifecycle'): string {
  uniqueSeq += 1;
  return `${prefix}-${uniqueSeq}@example.test`.toLowerCase();
}
function nextTestIp(): string {
  uniqueSeq += 1;
  return `10.${(uniqueSeq >> 8) & 0xff}.${uniqueSeq & 0xff}.4`;
}

async function fetchApi(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${BASE}${path}`, init);
}

function jsonHeaders(cookie: string) {
  return { 'content-type': 'application/json', cookie, ...STATE_CHANGING_HEADERS };
}

async function createVerifiedUser(email: string): Promise<string> {
  const ipHeaders = { 'cf-connecting-ip': nextTestIp() };
  const signUpResponse = await fetchApi('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS, ...ipHeaders },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Org Lifecycle Test' }),
  });
  expect(signUpResponse.status).toBe(200);
  await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').bind(email).run();
  const signInResponse = await fetchApi('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS, ...ipHeaders },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(signInResponse.status).toBe(200);
  const setCookie = signInResponse.headers.get('set-cookie');
  return setCookie?.split(';')[0] ?? '';
}

async function userIdForEmail(email: string): Promise<string> {
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();
  if (row === null) throw new Error('test setup: user row missing');
  return row.id;
}

async function createOrgForUser(cookie: string, name: string): Promise<string> {
  const response = await fetchApi('/api/org', {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { organization: { id: string } };
  return body.organization.id;
}

async function setUpOrg(label: string): Promise<{
  cookie: string;
  email: string;
  orgId: string;
  orgName: string;
}> {
  const email = uniqueEmail(label);
  const cookie = await createVerifiedUser(email);
  const orgName = `${label} Org ${uniqueSeq}`;
  const orgId = await createOrgForUser(cookie, orgName);
  return { cookie, email, orgId, orgName };
}

async function addMember(
  orgId: string,
  label: string,
): Promise<{ cookie: string; userId: string }> {
  const email = uniqueEmail(label);
  const cookie = await createVerifiedUser(email);
  const userId = await userIdForEmail(email);
  const db = createDb(env.DB);
  await addOrganizationMember(db, toOrganizationId(orgId), { userId, role: 'MEMBER' });
  return { cookie, userId };
}

let lotSeq = 0;
/** Seeds one notice + one lot (global corpus) — mirrors admin.d1.test.ts's seedLot. */
async function seedLot(db: Db): Promise<{ lotId: string; noticeId: string }> {
  lotSeq += 1;
  const sourceNoticeId = `org-lifecycle-${lotSeq}`;
  const { snapshot } = await insertSnapshotIfNewHash(db, {
    source: SOURCE,
    sourceNoticeId,
    versionNumber: 1,
    r2Key: `${SOURCE}/2026/08/${sourceNoticeId}/v1.xml`,
    contentHash: `hash-${sourceNoticeId}`,
    sizeBytes: 1024,
    contentType: 'application/xml',
  });
  const { noticeId, versionId } = await upsertNoticeWithVersion(db, {
    source: SOURCE,
    sourceNoticeId,
    noticeType: 'cn-standard',
    sourceLanguagesJson: JSON.stringify(['eng']),
    sourceUrl: `https://ted.europa.eu/notice/${sourceNoticeId}`,
    publicationDate: '2026-08-01',
    contentHash: `hash-${sourceNoticeId}`,
    snapshotId: snapshot.id,
  });
  const [lot] = await insertLots(db, {
    noticeVersionId: versionId,
    lots: [
      {
        lotNumber: '1',
        title: `Lot for ${sourceNoticeId}`,
        description: 'Detailed lot description.',
        contractNature: 'services',
        estimatedValueAmount: 100_000,
        estimatedValueCurrency: 'EUR',
        estimatedValueEur: 100_000,
        valueIsDerived: false,
        deadlineAt: Date.now() + 30 * 86_400_000,
      },
    ],
  });
  if (lot === undefined) throw new Error('test setup: lot insert failed');
  await insertCpvCodes(db, { entries: [{ lotId: lot.id, cpvCode: '72000000', isMain: true }] });
  await insertGeographies(db, { entries: [{ lotId: lot.id, countryCode: 'CY' }] });
  return { lotId: lot.id, noticeId };
}

async function seedMatch(
  db: Db,
  orgId: string,
  lot: { lotId: string; noticeId: string },
): Promise<string> {
  const args: TenderMatchInput = {
    lotId: lot.lotId,
    noticeId: lot.noticeId,
    engineVersion: ENGINE_VERSION,
    score: 90,
    classification: 'STRONG_MATCH',
    scoredAt: Date.now(),
    components: [
      {
        componentKey: 'cpv',
        points: 30,
        maxPoints: 35,
        status: 'MATCHED',
        explanation: 'seeded component',
      },
    ],
  };
  await insertTenderMatches(db, toOrganizationId(orgId), { matches: [args] });
  const row = await env.DB.prepare(
    'SELECT id FROM tender_matches WHERE organization_id = ? AND lot_id = ? ORDER BY id DESC LIMIT 1',
  )
    .bind(orgId, lot.lotId)
    .first<{ id: string }>();
  if (row === null) throw new Error('test setup: match row missing after insert');
  return row.id;
}

async function count(sql: string, ...binds: string[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('DELETE /api/org — organization deletion', () => {
  it('MEMBER cannot delete; wrong confirm 400s; correct confirm soft-deletes and blocks context', async () => {
    const { cookie: ownerCookie, orgId, orgName } = await setUpOrg('org-delete-basic');
    const { cookie: memberCookie } = await addMember(orgId, 'org-delete-basic-member');

    const memberAttempt = await fetchApi('/api/org', {
      method: 'DELETE',
      headers: jsonHeaders(memberCookie),
      body: JSON.stringify({ confirm: orgName }),
    });
    expect(memberAttempt.status).toBe(403);

    const wrongConfirm = await fetchApi('/api/org', {
      method: 'DELETE',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ confirm: 'not the real name' }),
    });
    expect(wrongConfirm.status).toBe(400);
    expect((await wrongConfirm.json()) as { error: string }).toEqual({
      error: 'confirm_mismatch',
    });

    // Still active — a member's normal read still works.
    const stillActive = await fetchApi('/api/org/profile', { headers: { cookie: memberCookie } });
    expect(stillActive.status).toBe(200);

    const deleted = await fetchApi('/api/org', {
      method: 'DELETE',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ confirm: orgName }),
    });
    expect(deleted.status).toBe(200);
    const deletedBody = (await deleted.json()) as { status: string; billing: string };
    expect(deletedBody.status).toBe('deleted');
    expect(deletedBody.billing).toBe('stripe:no_subscription');

    // Every member's org context is now blocked, distinctly from "never onboarded".
    const ownerAfter = await fetchApi('/api/org/profile', { headers: { cookie: ownerCookie } });
    expect(ownerAfter.status).toBe(403);
    expect((await ownerAfter.json()) as { error: string }).toEqual({
      error: 'organization_deleted',
    });
    const memberAfter = await fetchApi('/api/org/profile', { headers: { cookie: memberCookie } });
    expect(memberAfter.status).toBe(403);
    expect((await memberAfter.json()) as { error: string }).toEqual({
      error: 'organization_deleted',
    });

    const orgRow = await getOrganization(createDb(env.DB), toOrganizationId(orgId));
    expect(orgRow?.status).toBe('deleted');

    const auditRow = await env.DB.prepare(
      "SELECT action FROM audit_events WHERE organization_id = ? AND action = 'organization.deleted'",
    )
      .bind(orgId)
      .first<{ action: string }>();
    expect(auditRow?.action).toBe('organization.deleted');
  });

  it('SEC-P11-01: resolves the caller into a newer ACTIVE org, not an older deleted one, within the purge grace window', async () => {
    const { cookie, orgId: orgIdA, orgName: orgNameA } = await setUpOrg('resolve-active-a');

    const deleted = await fetchApi('/api/org', {
      method: 'DELETE',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: orgNameA }),
    });
    expect(deleted.status).toBe(200);

    // Deleted org A is still well within its 30-day purge grace period —
    // this is the exact shadowing scenario SEC-P11-01 fixes.
    const orgIdB = await createOrgForUser(cookie, `resolve-active-b Org ${uniqueSeq}`);
    expect(orgIdB).not.toBe(orgIdA);
    const db = createDb(env.DB);
    await upsertCompanyProfile(db, toOrganizationId(orgIdB), {
      displayName: 'Resolve Active B Co',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: null,
    });

    // Without SEC-P11-01, `requireOrganization` would resolve the caller
    // into the older, id-ascending deleted org A first and 403 with
    // `organization_deleted` — org B (the current, active org) must win.
    const profile = await fetchApi('/api/org/profile', { headers: { cookie } });
    expect(profile.status).toBe(200);
    const body = (await profile.json()) as { profile: { displayName: string } | null };
    expect(body.profile?.displayName).toBe('Resolve Active B Co');
  });

  it('excludes the org from digest and scoring eligibility immediately after deletion', async () => {
    const { cookie: ownerCookie, orgId, orgName } = await setUpOrg('org-delete-eligibility');
    const db = createDb(env.DB);
    const organizationId = toOrganizationId(orgId);
    await upsertCompanyProfile(db, organizationId, {
      displayName: 'Eligibility Co',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: Date.now(),
    });
    await replaceCompanyCpvPreferences(db, organizationId, { cpvCodes: ['72000000'] });
    await upsertDigestPreferences(db, organizationId, {
      enabled: true,
      sendEmpty: true,
      minClassification: 'LOW_FIT',
      timezone: 'Europe/Nicosia',
    });

    const beforeScoring = await listOrgsEligibleForScoring(db);
    expect(beforeScoring).toContain(organizationId);
    const beforeDigest = await listOrgsWithDigestEnabled(db);
    expect(beforeDigest.map((o) => o.organizationId)).toContain(organizationId);

    const deleted = await fetchApi('/api/org', {
      method: 'DELETE',
      headers: jsonHeaders(ownerCookie),
      body: JSON.stringify({ confirm: orgName }),
    });
    expect(deleted.status).toBe(200);

    const afterScoring = await listOrgsEligibleForScoring(db);
    expect(afterScoring).not.toContain(organizationId);
    const afterDigest = await listOrgsWithDigestEnabled(db);
    expect(afterDigest.map((o) => o.organizationId)).not.toContain(organizationId);
  });
});

describe('runOrgPurge — deleted-organization hard purge', () => {
  it('leaves a not-yet-grace-expired deleted org fully intact', async () => {
    const db = createDb(env.DB);
    const ownerEmail = uniqueEmail('pre-grace-owner');
    await createVerifiedUser(ownerEmail);
    const ownerId = await userIdForEmail(ownerEmail);
    const { organization } = await createOrganization(db, {
      name: 'Pre-Grace Org',
      createdByUserId: ownerId,
    });
    const organizationId = toOrganizationId(organization.id);
    await upsertCompanyProfile(db, organizationId, {
      displayName: 'Pre Grace',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: null,
    });
    await softDeleteOrganization(db, organizationId);

    const result = await runOrgPurge({
      db,
      logger: createLogger({ test: true }),
      graceDays: 30,
      limit: 500,
    });
    expect(result.organizationsPurged).toBe(0);
    expect(
      await count(
        'SELECT COUNT(*) as n FROM company_profiles WHERE organization_id = ?',
        organization.id,
      ),
    ).toBe(1);
    const row = await getOrganization(db, organizationId);
    expect(row?.name).toBe('Pre-Grace Org');
  });

  it('hard-deletes every owned table past the grace period, tombstones the org, and never touches the global corpus or retained ledgers', async () => {
    const db = createDb(env.DB);
    const ownerEmail = uniqueEmail('purge-owner');
    await createVerifiedUser(ownerEmail);
    const ownerId = await userIdForEmail(ownerEmail);
    const { organization } = await createOrganization(db, {
      name: 'Full Purge Org',
      createdByUserId: ownerId,
    });
    const organizationId = toOrganizationId(organization.id);

    // Company profile & preference tables (9 rows total).
    await upsertCompanyProfile(db, organizationId, {
      displayName: 'Full Purge',
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: null,
    });
    await replaceCompanyCapabilities(db, organizationId, { labels: ['cloud'] });
    await replaceCompanyCertifications(db, organizationId, {
      certifications: [{ certificationCode: 'ISO_27001' }],
    });
    await replaceCompanyCpvPreferences(db, organizationId, { cpvCodes: ['72000000'] });
    await replaceCompanyGeographies(db, organizationId, {
      geographies: [{ kind: 'country_served', code: 'CY' }],
    });
    await replaceCompanyKeywords(db, organizationId, {
      keywords: [{ kind: 'positive', term: 'consulting' }],
    });
    await replaceCompanyExclusions(db, organizationId, {
      exclusions: [{ kind: 'country', value: 'RU' }],
    });
    await upsertMatchingPreferences(db, organizationId, {
      minValueEur: null,
      maxValueEur: null,
      supportedContractNatures: ['services'],
      minimumDaysRemaining: null,
    });
    await upsertDigestPreferences(db, organizationId, {
      enabled: true,
      sendEmpty: true,
      minClassification: 'LOW_FIT',
      timezone: 'Europe/Nicosia',
    });

    // Global corpus + one match, one saved / one ignored / one feedback row.
    const lot = await seedLot(db);
    const matchId = await seedMatch(db, organization.id, lot);
    await saveTender(db, organizationId, {
      lotId: lot.lotId,
      noticeId: lot.noticeId,
      savedByUserId: ownerId,
    });
    await ignoreTender(db, organizationId, {
      lotId: lot.lotId,
      noticeId: lot.noticeId,
      ignoredByUserId: ownerId,
      reason: 'not a fit',
    });
    await upsertCustomerFeedback(db, organizationId, {
      matchId,
      userId: ownerId,
      verdict: 'useful',
    });

    // Digest run + item, email delivery.
    const digestRun = await createDigestRun(db, organizationId, {
      digestDate: '2026-08-15',
      matchesCount: 1,
    });
    await insertDigestItems(db, organizationId, {
      digestRunId: digestRun.id,
      items: [
        {
          matchId,
          rank: 1,
          titleSnapshot: 'Full Purge Lot',
          scoreSnapshot: 90,
          classificationSnapshot: 'STRONG_MATCH',
        },
      ],
    });
    await createEmailDelivery(db, organizationId, {
      kind: 'digest',
      toEmail: ownerEmail,
      provider: 'resend',
    });

    // Support note, product event, subscription, one manual audit row.
    await insertSupportNote(db, organizationId, { authorUserId: ownerId, body: 'test note' });
    await insertProductEvent(db, { organizationId, userId: ownerId, name: 'feed_viewed' });
    await upsertSubscriptionByStripeCustomerId(db, organizationId, {
      stripeCustomerId: `cus_full_purge_${organization.id}`,
      stripeSubscriptionId: `sub_full_purge_${organization.id}`,
      status: 'canceled',
      plan: 'standard',
      currentPeriodEndAt: null,
      cancelAtPeriodEnd: true,
    });
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: ownerId,
      organizationId,
      action: 'organization.deleted',
      targetType: 'organization',
      targetId: organization.id,
      occurredAt: Date.now(),
    });

    await softDeleteOrganization(db, organizationId);
    // Backdate past the 30-day grace window so this run is eligible.
    await env.DB.prepare('UPDATE organizations SET updated_at = ? WHERE id = ?')
      .bind(Date.now() - 31 * 86_400_000, organization.id)
      .run();

    const result = await runOrgPurge({
      db,
      logger: createLogger({ test: true }),
      graceDays: 30,
      limit: 500,
    });
    expect(result.organizationsPurged).toBe(1);
    expect(result.totals.tenderMatchesDeleted).toBeGreaterThanOrEqual(1);
    expect(result.totals.savedTendersDeleted).toBeGreaterThanOrEqual(1);
    expect(result.totals.ignoredTendersDeleted).toBeGreaterThanOrEqual(1);
    expect(result.totals.customerFeedbackDeleted).toBeGreaterThanOrEqual(1);
    expect(result.totals.digestItemsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.totals.digestRunsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.totals.emailDeliveriesDeleted).toBeGreaterThanOrEqual(1);
    expect(result.totals.companyRowsDeleted).toBeGreaterThanOrEqual(9);
    expect(result.totals.supportNotesDeleted).toBeGreaterThanOrEqual(1);
    expect(result.totals.productEventsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.totals.organizationMembersDeleted).toBeGreaterThanOrEqual(1);

    // Every owned table is empty for this org id.
    for (const [table, column] of [
      ['tender_matches', 'organization_id'],
      ['saved_tenders', 'organization_id'],
      ['ignored_tenders', 'organization_id'],
      ['customer_feedback', 'organization_id'],
      ['digest_runs', 'organization_id'],
      ['email_deliveries', 'organization_id'],
      ['company_profiles', 'organization_id'],
      ['company_capabilities', 'organization_id'],
      ['company_certifications', 'organization_id'],
      ['company_cpv_preferences', 'organization_id'],
      ['company_geographies', 'organization_id'],
      ['company_keywords', 'organization_id'],
      ['company_exclusions', 'organization_id'],
      ['matching_preferences', 'organization_id'],
      ['digest_preferences', 'organization_id'],
      ['support_notes', 'organization_id'],
      ['product_events', 'organization_id'],
      ['organization_members', 'organization_id'],
    ] as const) {
      expect(
        await count(`SELECT COUNT(*) as n FROM ${table} WHERE ${column} = ?`, organization.id),
      ).toBe(0);
    }
    expect(
      await count('SELECT COUNT(*) as n FROM digest_items WHERE digest_run_id = ?', digestRun.id),
    ).toBe(0);
    expect(
      await count('SELECT COUNT(*) as n FROM match_components WHERE match_id = ?', matchId),
    ).toBe(0);
    expect(
      await count('SELECT COUNT(*) as n FROM match_risk_flags WHERE match_id = ?', matchId),
    ).toBe(0);

    // NEVER purged: billing/legal record and append-only ledgers, still
    // pointing at this (now-tombstoned) organization id.
    expect(
      await count(
        'SELECT COUNT(*) as n FROM subscriptions WHERE organization_id = ?',
        organization.id,
      ),
    ).toBe(1);
    expect(
      await count(
        'SELECT COUNT(*) as n FROM audit_events WHERE organization_id = ?',
        organization.id,
      ),
    ).toBeGreaterThanOrEqual(1);

    // The organization row is a tombstone, not deleted.
    const orgRow = await getOrganization(db, organizationId);
    expect(orgRow).not.toBeNull();
    expect(orgRow?.status).toBe('deleted');
    expect(orgRow?.name).toBe(`deleted-${organization.id}`);

    // Global corpus is untouched — saved_tenders "pinning" only matters to
    // the TENDER-retention purge (packages/procurement `purge.ts`), never
    // to this org purge: the org's OWN save/ignore/feedback rows are
    // deleted regardless, and the underlying lot/notice survive because
    // this job never touches global tables at all.
    expect(await count('SELECT COUNT(*) as n FROM tender_lots WHERE id = ?', lot.lotId)).toBe(1);
    expect(await count('SELECT COUNT(*) as n FROM tender_notices WHERE id = ?', lot.noticeId)).toBe(
      1,
    );

    // A second run is a no-op (idempotent — the tombstone name excludes it
    // from the next scan).
    const secondRun = await runOrgPurge({
      db,
      logger: createLogger({ test: true }),
      graceDays: 30,
      limit: 500,
    });
    expect(secondRun.organizationsPurged).toBe(0);
  });

  it('P11-R-01: purges a deleted org whose real name happens to start with the tombstone prefix', async () => {
    const db = createDb(env.DB);
    const ownerEmail = uniqueEmail('tombstone-collision-owner');
    await createVerifiedUser(ownerEmail);
    const ownerId = await userIdForEmail(ownerEmail);
    // A genuine org name that collides with the `deleted-%` LIKE prefix the
    // old eligibility check used — must NOT be permanently excluded from
    // the purge scan just because of its name.
    const { organization } = await createOrganization(db, {
      name: 'Deleted-Data GmbH',
      createdByUserId: ownerId,
    });
    const organizationId = toOrganizationId(organization.id);
    await softDeleteOrganization(db, organizationId);
    await env.DB.prepare('UPDATE organizations SET updated_at = ? WHERE id = ?')
      .bind(Date.now() - 31 * 86_400_000, organization.id)
      .run();

    const result = await runOrgPurge({
      db,
      logger: createLogger({ test: true }),
      graceDays: 30,
      limit: 500,
    });
    expect(result.organizationsPurged).toBe(1);

    const orgRow = await getOrganization(db, organizationId);
    expect(orgRow?.name).toBe(`deleted-${organization.id}`);
  });

  it('P11-R-01: an already-tombstoned org is excluded from a second scan (exact-match idempotency)', async () => {
    const db = createDb(env.DB);
    const ownerEmail = uniqueEmail('tombstone-idempotent-owner');
    await createVerifiedUser(ownerEmail);
    const ownerId = await userIdForEmail(ownerEmail);
    const { organization } = await createOrganization(db, {
      name: 'Tombstone Idempotency Org',
      createdByUserId: ownerId,
    });
    const organizationId = toOrganizationId(organization.id);
    await softDeleteOrganization(db, organizationId);
    await env.DB.prepare('UPDATE organizations SET updated_at = ? WHERE id = ?')
      .bind(Date.now() - 31 * 86_400_000, organization.id)
      .run();

    const first = await runOrgPurge({
      db,
      logger: createLogger({ test: true }),
      graceDays: 30,
      limit: 500,
    });
    expect(first.organizationsPurged).toBe(1);

    const second = await runOrgPurge({
      db,
      logger: createLogger({ test: true }),
      graceDays: 30,
      limit: 500,
    });
    expect(second.organizationsPurged).toBe(0);
  });
});

describe('nullifyOrganizationCreator — P11-R-02 grace-clock integrity', () => {
  it('does not bump updated_at (the purge grace clock) for an already-deleted org', async () => {
    const db = createDb(env.DB);
    const ownerEmail = uniqueEmail('grace-clock-owner');
    await createVerifiedUser(ownerEmail);
    const ownerId = await userIdForEmail(ownerEmail);
    const { organization } = await createOrganization(db, {
      name: 'Grace Clock Org',
      createdByUserId: ownerId,
    });
    const organizationId = toOrganizationId(organization.id);
    await softDeleteOrganization(db, organizationId);

    const beforeRow = await getOrganization(db, organizationId);
    const originalUpdatedAt = beforeRow?.updatedAt;
    expect(originalUpdatedAt).toBeDefined();

    // Simulate the creator's account being deleted well after the org's own
    // soft-delete — nullifyOrganizationCreator must not touch updated_at.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await nullifyOrganizationCreator(db, ownerId);

    const afterRow = await getOrganization(db, organizationId);
    expect(afterRow?.createdByUserId).toBeNull();
    expect(afterRow?.updatedAt).toBe(originalUpdatedAt);
  });
});

describe('runLedgerPurge — SEC-P11-04 time-based ledger purge', () => {
  it('purges audit_events/email_deliveries/product_events past their retention windows, leaves recent rows untouched', async () => {
    const db = createDb(env.DB);
    const ownerEmail = uniqueEmail('ledger-purge-owner');
    await createVerifiedUser(ownerEmail);
    const ownerId = await userIdForEmail(ownerEmail);
    const { organization } = await createOrganization(db, {
      name: 'Ledger Purge Org',
      createdByUserId: ownerId,
    });
    const organizationId = toOrganizationId(organization.id);

    const DAY_MS = 86_400_000;
    const now = Date.now();
    const oldAuditAt = now - (24 * 30 + 1) * DAY_MS; // just past 24 months
    const recentAuditAt = now - 30 * DAY_MS;
    const oldLedgerAt = now - (365 + 1) * DAY_MS; // just past 12 months
    const recentLedgerAt = now - 30 * DAY_MS;

    // audit_events: one old, one recent.
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: ownerId,
      organizationId,
      action: 'ledger_purge_test.old',
      targetType: 'organization',
      targetId: organization.id,
      occurredAt: oldAuditAt,
    });
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: ownerId,
      organizationId,
      action: 'ledger_purge_test.recent',
      targetType: 'organization',
      targetId: organization.id,
      occurredAt: recentAuditAt,
    });

    // email_deliveries: one old, one recent (both digest-kind via the
    // repository helper, then backdated directly).
    const oldDelivery = await createEmailDelivery(db, organizationId, {
      kind: 'digest',
      toEmail: ownerEmail,
      provider: 'resend',
    });
    await env.DB.prepare('UPDATE email_deliveries SET created_at = ? WHERE id = ?')
      .bind(oldLedgerAt, oldDelivery.id)
      .run();
    const recentDelivery = await createEmailDelivery(db, organizationId, {
      kind: 'digest',
      toEmail: ownerEmail,
      provider: 'resend',
    });
    await env.DB.prepare('UPDATE email_deliveries SET created_at = ? WHERE id = ?')
      .bind(recentLedgerAt, recentDelivery.id)
      .run();

    // product_events: one old, one recent.
    await insertProductEvent(db, {
      organizationId,
      userId: ownerId,
      name: 'ledger_purge_test_old',
    });
    await insertProductEvent(db, {
      organizationId,
      userId: ownerId,
      name: 'ledger_purge_test_recent',
    });
    const oldEventRow = await env.DB.prepare(
      "SELECT id FROM product_events WHERE name = 'ledger_purge_test_old'",
    ).first<{ id: string }>();
    if (oldEventRow === null) throw new Error('test setup: product_events row missing');
    await env.DB.prepare('UPDATE product_events SET created_at = ? WHERE id = ?')
      .bind(oldLedgerAt, oldEventRow.id)
      .run();

    const result = await runLedgerPurge({ db, logger: createLogger({ test: true }) });
    expect(result.auditEventsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.emailDeliveriesDeleted).toBeGreaterThanOrEqual(1);
    expect(result.productEventsDeleted).toBeGreaterThanOrEqual(1);

    expect(
      await count("SELECT COUNT(*) as n FROM audit_events WHERE action = 'ledger_purge_test.old'"),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) as n FROM audit_events WHERE action = 'ledger_purge_test.recent'",
      ),
    ).toBe(1);

    expect(
      await count('SELECT COUNT(*) as n FROM email_deliveries WHERE id = ?', oldDelivery.id),
    ).toBe(0);
    expect(
      await count('SELECT COUNT(*) as n FROM email_deliveries WHERE id = ?', recentDelivery.id),
    ).toBe(1);

    expect(
      await count("SELECT COUNT(*) as n FROM product_events WHERE name = 'ledger_purge_test_old'"),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) as n FROM product_events WHERE name = 'ledger_purge_test_recent'",
      ),
    ).toBe(1);
  });

  it('detaches digest_runs.email_delivery_id before deleting an old-but-referenced email_deliveries row', async () => {
    const db = createDb(env.DB);
    const ownerEmail = uniqueEmail('ledger-purge-fk-owner');
    await createVerifiedUser(ownerEmail);
    const ownerId = await userIdForEmail(ownerEmail);
    const { organization } = await createOrganization(db, {
      name: 'Ledger Purge FK Org',
      createdByUserId: ownerId,
    });
    const organizationId = toOrganizationId(organization.id);

    const delivery = await createEmailDelivery(db, organizationId, {
      kind: 'digest',
      toEmail: ownerEmail,
      provider: 'resend',
    });
    const DAY_MS = 86_400_000;
    const oldAt = Date.now() - (365 + 1) * DAY_MS;
    await env.DB.prepare('UPDATE email_deliveries SET created_at = ? WHERE id = ?')
      .bind(oldAt, delivery.id)
      .run();

    const digestRun = await createDigestRun(db, organizationId, {
      digestDate: '2024-01-01',
      matchesCount: 0,
    });
    await env.DB.prepare('UPDATE digest_runs SET email_delivery_id = ? WHERE id = ?')
      .bind(delivery.id, digestRun.id)
      .run();

    await runLedgerPurge({ db, logger: createLogger({ test: true }) });

    expect(
      await count('SELECT COUNT(*) as n FROM email_deliveries WHERE id = ?', delivery.id),
    ).toBe(0);
    const digestRunRow = await env.DB.prepare(
      'SELECT email_delivery_id FROM digest_runs WHERE id = ?',
    )
      .bind(digestRun.id)
      .first<{ email_delivery_id: string | null }>();
    expect(digestRunRow?.email_delivery_id).toBeNull();
  });

  it('ADR-0008 §3: purges terminal (recovered/abandoned) ingestion_fetch_retries rows past 90 days; leaves recent and pending rows untouched', async () => {
    const db = createDb(env.DB);
    const DAY_MS = 86_400_000;
    const now = Date.now();
    const oldAt = now - 91 * DAY_MS;

    // Old + recovered -> purge-eligible.
    const oldRecovered = await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: `fetch-retry-purge-old-recovered-${String(now)}`,
      xmlUrl: 'https://ted.europa.eu/notice/purge-old-recovered.xml',
      publicationDate: '2026-01-01',
      errorCode: 'NOTICE_FETCH_HTTP_500',
      nextAttemptAt: now,
    });
    await markFetchRetryRecovered(db, { id: oldRecovered.id, now: oldAt });

    // Old + abandoned -> purge-eligible.
    const oldAbandoned = await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: `fetch-retry-purge-old-abandoned-${String(now)}`,
      xmlUrl: 'https://ted.europa.eu/notice/purge-old-abandoned.xml',
      publicationDate: '2026-01-01',
      errorCode: 'NOTICE_FETCH_HTTP_500',
      nextAttemptAt: now,
    });
    await markFetchRetryAbandoned(db, { id: oldAbandoned.id, now: oldAt });

    // Old + still pending -> NEVER purged by age, regardless of how old.
    const oldPending = await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: `fetch-retry-purge-old-pending-${String(now)}`,
      xmlUrl: 'https://ted.europa.eu/notice/purge-old-pending.xml',
      publicationDate: '2026-01-01',
      errorCode: 'NOTICE_FETCH_HTTP_500',
      nextAttemptAt: oldAt,
      now: oldAt,
    });

    // Recent + recovered -> untouched (inside the 90-day window).
    const recentRecovered = await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: `fetch-retry-purge-recent-recovered-${String(now)}`,
      xmlUrl: 'https://ted.europa.eu/notice/purge-recent-recovered.xml',
      publicationDate: '2026-01-01',
      errorCode: 'NOTICE_FETCH_HTTP_500',
      nextAttemptAt: now,
    });
    await markFetchRetryRecovered(db, { id: recentRecovered.id, now: now - 1 * DAY_MS });

    const result = await runLedgerPurge({ db, logger: createLogger({ test: true }) });
    expect(result.fetchRetriesDeleted).toBeGreaterThanOrEqual(2);

    expect(
      await count(
        'SELECT COUNT(*) as n FROM ingestion_fetch_retries WHERE id = ?',
        oldRecovered.id,
      ),
    ).toBe(0);
    expect(
      await count(
        'SELECT COUNT(*) as n FROM ingestion_fetch_retries WHERE id = ?',
        oldAbandoned.id,
      ),
    ).toBe(0);
    expect(
      await count('SELECT COUNT(*) as n FROM ingestion_fetch_retries WHERE id = ?', oldPending.id),
    ).toBe(1);
    expect(
      await count(
        'SELECT COUNT(*) as n FROM ingestion_fetch_retries WHERE id = ?',
        recentRecovered.id,
      ),
    ).toBe(1);
  });
});

describe('DELETE /api/account — departing-MEMBER authored-row FK edge (migration 0005)', () => {
  it('SET NULLs a member’s authored saved/ignored/feedback rows instead of failing on the users FK', async () => {
    const { orgId } = await setUpOrg('account-fk-owner');
    const { cookie: memberCookie, userId: memberId } = await addMember(orgId, 'account-fk-member');
    const db = createDb(env.DB);
    const organizationId = toOrganizationId(orgId);
    const lot = await seedLot(db);
    const matchId = await seedMatch(db, orgId, lot);

    await saveTender(db, organizationId, {
      lotId: lot.lotId,
      noticeId: lot.noticeId,
      savedByUserId: memberId,
    });
    await ignoreTender(db, organizationId, {
      lotId: lot.lotId,
      noticeId: lot.noticeId,
      ignoredByUserId: memberId,
      reason: 'test',
    });
    await upsertCustomerFeedback(db, organizationId, {
      matchId,
      userId: memberId,
      verdict: 'not_useful',
    });

    const deleteResponse = await fetchApi('/api/account', {
      method: 'DELETE',
      headers: jsonHeaders(memberCookie),
    });
    expect(deleteResponse.status).toBe(204);

    // Membership gone.
    expect(
      await count(
        'SELECT COUNT(*) as n FROM organization_members WHERE organization_id = ? AND user_id = ?',
        orgId,
        memberId,
      ),
    ).toBe(0);
    // Auth user gone.
    expect(await count('SELECT COUNT(*) as n FROM users WHERE id = ?', memberId)).toBe(0);

    // Org data SURVIVES — only the authorship attribution is nulled.
    const savedRow = await env.DB.prepare(
      'SELECT saved_by_user_id FROM saved_tenders WHERE organization_id = ? AND lot_id = ?',
    )
      .bind(orgId, lot.lotId)
      .first<{ saved_by_user_id: string | null }>();
    expect(savedRow?.saved_by_user_id).toBeNull();

    const ignoredRow = await env.DB.prepare(
      'SELECT ignored_by_user_id FROM ignored_tenders WHERE organization_id = ? AND lot_id = ?',
    )
      .bind(orgId, lot.lotId)
      .first<{ ignored_by_user_id: string | null }>();
    expect(ignoredRow?.ignored_by_user_id).toBeNull();

    const feedbackRow = await env.DB.prepare(
      'SELECT user_id FROM customer_feedback WHERE organization_id = ? AND match_id = ?',
    )
      .bind(orgId, matchId)
      .first<{ user_id: string | null }>();
    expect(feedbackRow?.user_id).toBeNull();
  });

  it('a sole OWNER of an already-deleted organization can still delete their account', async () => {
    const { cookie, orgId, orgName, email } = await setUpOrg('account-fk-sole-owner');
    const deleteOrgResponse = await fetchApi('/api/org', {
      method: 'DELETE',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: orgName }),
    });
    expect(deleteOrgResponse.status).toBe(200);

    const deleteAccountResponse = await fetchApi('/api/account', {
      method: 'DELETE',
      headers: jsonHeaders(cookie),
    });
    expect(deleteAccountResponse.status).toBe(204);

    const userId = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string }>();
    expect(userId).toBeNull();
    expect(
      await count(
        'SELECT COUNT(*) as n FROM organization_members WHERE organization_id = ?',
        orgId,
      ),
    ).toBe(0);
  });

  it('P11-R-04: SET NULLs email_deliveries.user_id for the departing user, keeping the row', async () => {
    const { orgId } = await setUpOrg('account-fk-email-owner');
    const { cookie: memberCookie, userId: memberId } = await addMember(
      orgId,
      'account-fk-email-member',
    );

    // No current writer sets `email_deliveries.user_id` (see
    // nullifyUserEmailDeliveries's doc) — insert a row directly to exercise
    // the FK-safety path a future auth-mail delivery-tracking writer would
    // create. `organization_id` is set too so the CHECK constraint
    // (`organization_id IS NOT NULL OR user_id IS NOT NULL`) still holds
    // after user_id is nulled.
    const deliveryId = `test-delivery-${memberId}`;
    await env.DB.prepare(
      `INSERT INTO email_deliveries
         (id, organization_id, user_id, kind, to_email, provider, provider_message_id, status, error, created_at, updated_at)
       VALUES (?, ?, ?, 'verification', ?, 'resend', NULL, 'sent', NULL, ?, ?)`,
    )
      .bind(deliveryId, orgId, memberId, 'member@example.test', Date.now(), Date.now())
      .run();

    const deleteResponse = await fetchApi('/api/account', {
      method: 'DELETE',
      headers: jsonHeaders(memberCookie),
    });
    expect(deleteResponse.status).toBe(204);

    const row = await env.DB.prepare('SELECT user_id FROM email_deliveries WHERE id = ?')
      .bind(deliveryId)
      .first<{ user_id: string | null }>();
    expect(row).not.toBeNull();
    expect(row?.user_id).toBeNull();
  });
});

describe('GET /api/org/export — data export', () => {
  it('OWNER-only, correct bundle shape, and cross-org isolation', async () => {
    const { cookie: ownerCookie, orgId, email } = await setUpOrg('export-owner');
    const { cookie: memberCookie } = await addMember(orgId, 'export-member');
    const db = createDb(env.DB);
    const organizationId = toOrganizationId(orgId);
    const ownerId = await userIdForEmail(email);

    await upsertCompanyProfile(db, organizationId, {
      displayName: 'Export Co',
      description: 'A test company',
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: null,
    });
    const lot = await seedLot(db);
    await saveTender(db, organizationId, {
      lotId: lot.lotId,
      noticeId: lot.noticeId,
      savedByUserId: ownerId,
    });

    const memberDenied = await fetchApi('/api/org/export', { headers: { cookie: memberCookie } });
    expect(memberDenied.status).toBe(403);

    const ownerResponse = await fetchApi('/api/org/export', { headers: { cookie: ownerCookie } });
    expect(ownerResponse.status).toBe(200);
    const bundle = (await ownerResponse.json()) as {
      organizationId: string;
      profile: { displayName: string } | null;
      savedTenders: { lotId: string; title: string }[];
      truncated: boolean;
    };
    expect(bundle.organizationId).toBe(orgId);
    expect(bundle.profile?.displayName).toBe('Export Co');
    expect(bundle.savedTenders).toHaveLength(1);
    expect(bundle.savedTenders[0]?.lotId).toBe(lot.lotId);
    expect(bundle.savedTenders[0]?.title).toMatch(/^Lot for org-lifecycle-\d+$/);
    expect(bundle.truncated).toBe(false);

    // Cross-org isolation: a second org's export never sees the first org's data.
    const { cookie: owner2Cookie, orgId: orgId2 } = await setUpOrg('export-owner-2');
    const bundle2Response = await fetchApi('/api/org/export', {
      headers: { cookie: owner2Cookie },
    });
    expect(bundle2Response.status).toBe(200);
    const bundle2 = (await bundle2Response.json()) as {
      organizationId: string;
      savedTenders: unknown[];
    };
    expect(bundle2.organizationId).toBe(orgId2);
    expect(bundle2.savedTenders).toHaveLength(0);

    // Repository-level cross-org isolation directly, too.
    const directBundle = await getOrgExportBundle(db, organizationId);
    expect(directBundle.savedTenders.map((s) => s.lotId)).toEqual([lot.lotId]);
  });
});

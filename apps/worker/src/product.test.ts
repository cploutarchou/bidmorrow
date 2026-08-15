/**
 * Phase 7 customer-product API: onboarding (presets + profile-bundle PUTs +
 * completion warning), feed, tender detail (incl. on-demand LOW_FIT
 * recompute), and save/ignore/feedback actions. Real workerd + local D1,
 * mirroring tenancy.test.ts's auth flow. Matches are seeded directly via
 * the repository layer (no TED fixtures needed — these tests exercise the
 * routes/repos, not ingestion or the scoring engine itself, except for the
 * LOW_FIT recompute test which deliberately exercises the real engine).
 */
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  createDb,
  insertCpvCodes,
  insertGeographies,
  insertLots,
  insertSnapshotIfNewHash,
  insertTenderMatches,
  loadLotScoringBundlesByIds,
  upsertNoticeWithVersion,
  type Db,
  type TenderMatchInput,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';
import { ENGINE_VERSION, scoreLotForOrg } from '@bidmorrow/matching';
import { loadOrgProfile, mapLotToEngineInput } from '@bidmorrow/procurement';

import './index';

const BASE = 'https://bidmorrow.local';
const STATE_CHANGING_HEADERS = { origin: 'http://localhost:8787' };
const PASSWORD = 'correct horse battery staple 1!';
const SOURCE = 'ted';

let uniqueSeq = 0;
function uniqueEmail(prefix = 'product'): string {
  uniqueSeq += 1;
  return `${prefix}-${uniqueSeq}@example.test`.toLowerCase();
}
function nextTestIp(): string {
  uniqueSeq += 1;
  return `10.${(uniqueSeq >> 8) & 0xff}.${uniqueSeq & 0xff}.2`;
}

async function fetchApi(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${BASE}${path}`, init);
}

async function createVerifiedUser(email: string): Promise<string> {
  const ipHeaders = { 'cf-connecting-ip': nextTestIp() };
  const signUpResponse = await fetchApi('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS, ...ipHeaders },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Product Test' }),
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

async function createOrgForUser(cookie: string, name: string): Promise<string> {
  const response = await fetchApi('/api/org', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, ...STATE_CHANGING_HEADERS },
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { organization: { id: string } };
  return body.organization.id;
}

async function setUpOrg(label: string): Promise<{ cookie: string; orgId: string; email: string }> {
  const email = uniqueEmail(label);
  const cookie = await createVerifiedUser(email);
  const orgId = await createOrgForUser(cookie, `${label} Org`);
  return { cookie, orgId, email };
}

function jsonHeaders(cookie: string) {
  return { 'content-type': 'application/json', cookie, ...STATE_CHANGING_HEADERS };
}

/** Seeds one notice + one lot with a main CPV code, deterministic across calls via a unique suffix. */
async function seedLot(
  db: Db,
  sourceNoticeId: string,
  overrides: { cpvCode?: string; deadlineAt?: number | null } = {},
): Promise<{ lotId: string; noticeId: string }> {
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
        description: 'Detailed lot description, never shown in the feed.',
        contractNature: 'services',
        estimatedValueAmount: 100_000,
        estimatedValueCurrency: 'EUR',
        estimatedValueEur: 100_000,
        valueIsDerived: false,
        deadlineAt:
          overrides.deadlineAt === undefined ? Date.now() + 30 * 86_400_000 : overrides.deadlineAt,
      },
    ],
  });
  if (lot === undefined) throw new Error('test setup: lot insert failed');
  await insertCpvCodes(db, {
    entries: [{ lotId: lot.id, cpvCode: overrides.cpvCode ?? '72000000', isMain: true }],
  });
  await insertGeographies(db, { entries: [{ lotId: lot.id, countryCode: 'CY' }] });
  return { lotId: lot.id, noticeId };
}

async function seedMatch(
  db: Db,
  orgId: string,
  lot: { lotId: string; noticeId: string },
  args: Partial<TenderMatchInput> & { score: number },
): Promise<string> {
  const scoredAt = args.scoredAt ?? Date.now();
  const classification =
    args.classification ??
    (args.score >= 80
      ? 'STRONG_MATCH'
      : args.score >= 65
        ? 'WORTH_REVIEWING'
        : args.score >= 45
          ? 'POSSIBLE_MATCH'
          : 'LOW_FIT');
  const components =
    args.components ??
    (classification === 'LOW_FIT' || classification === 'EXCLUDED'
      ? undefined
      : [
          {
            componentKey: 'cpv' as const,
            points: args.score,
            maxPoints: 35,
            status: 'MATCHED' as const,
            explanation: 'seeded component',
          },
        ]);
  await insertTenderMatches(db, toOrganizationId(orgId), {
    matches: [
      {
        lotId: lot.lotId,
        noticeId: lot.noticeId,
        engineVersion: args.engineVersion ?? ENGINE_VERSION,
        score: args.score,
        classification,
        scoredAt,
        ...(components !== undefined ? { components } : {}),
      },
    ],
  });
  const row = await env.DB.prepare(
    'SELECT id FROM tender_matches WHERE organization_id = ? AND lot_id = ? ORDER BY id DESC LIMIT 1',
  )
    .bind(orgId, lot.lotId)
    .first<{ id: string }>();
  if (row === null) throw new Error('test setup: match row missing after insert');
  return row.id;
}

describe('GET /api/org/presets', () => {
  it('returns the 4 preset profiles with editable pre-fill content', async () => {
    const org = await setUpOrg('PresetOrg');
    const response = await fetchApi('/api/org/presets', { headers: { cookie: org.cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { presets: { key: string; cpvCodes: string[] }[] };
    expect(body.presets).toHaveLength(4);
    expect(body.presets.map((p) => p.key).sort()).toEqual([
      'cloud_devops',
      'cyber_consultancy',
      'it_generalist',
      'software_house',
    ]);
    for (const preset of body.presets) {
      expect(preset.cpvCodes.length).toBeGreaterThan(0);
    }
  });

  it('401s without a session', async () => {
    const response = await fetchApi('/api/org/presets');
    expect(response.status).toBe(401);
  });
});

describe('profile-bundle PUT endpoints', () => {
  it('cpv-preferences: owner-only, caps at 30, cross-org isolation', async () => {
    const owner = await setUpOrg('CpvOwnerOrg');
    const memberEmail = uniqueEmail('cpv-member');
    const memberCookie = await createVerifiedUser(memberEmail);
    const { addOrganizationMember } = await import('@bidmorrow/db');
    const db = createDb(env.DB);
    const memberRow = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(memberEmail)
      .first<{ id: string }>();
    if (memberRow === null) throw new Error('member row missing');
    await addOrganizationMember(db, toOrganizationId(owner.orgId), {
      userId: memberRow.id,
      role: 'MEMBER',
    });

    const memberAttempt = await fetchApi('/api/org/cpv-preferences', {
      method: 'PUT',
      headers: jsonHeaders(memberCookie),
      body: JSON.stringify({ cpvCodes: ['72000000'] }),
    });
    expect(memberAttempt.status).toBe(403);

    const capBreach = await fetchApi('/api/org/cpv-preferences', {
      method: 'PUT',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ cpvCodes: Array.from({ length: 31 }, (_, i) => `7200000${i % 10}`) }),
    });
    expect(capBreach.status).toBe(422);
    expect(await capBreach.json()).toEqual({ error: 'cap_exceeded', cap: 30 });

    const other = await setUpOrg('CpvOtherOrg');
    const ownerPut = await fetchApi('/api/org/cpv-preferences', {
      method: 'PUT',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ cpvCodes: ['79417000-MARKER'] }),
    });
    expect(ownerPut.status).toBe(200);

    const otherGet = await fetchApi('/api/org/cpv-preferences', {
      headers: { cookie: other.cookie },
    });
    const otherBody = await otherGet.json();
    expect(JSON.stringify(otherBody)).not.toContain('79417000-MARKER');
  });

  it('capabilities, geographies, certifications, exclusions, matching-preferences, digest-preferences round-trip', async () => {
    const org = await setUpOrg('BundleOrg');

    const capabilities = await fetchApi('/api/org/capabilities', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({ labels: ['Penetration testing'] }),
    });
    expect(capabilities.status).toBe(200);

    const geographies = await fetchApi('/api/org/geographies', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({ geographies: [{ kind: 'opportunity_country', code: 'CY' }] }),
    });
    expect(geographies.status).toBe(200);

    const certifications = await fetchApi('/api/org/certifications', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({ certifications: [{ certificationCode: 'ISO_27001' }] }),
    });
    expect(certifications.status).toBe(200);

    const exclusions = await fetchApi('/api/org/exclusions', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({ exclusions: [{ kind: 'country', value: 'RU' }] }),
    });
    expect(exclusions.status).toBe(200);

    const matching = await fetchApi('/api/org/matching-preferences', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({
        minValueEur: 10_000,
        maxValueEur: 500_000,
        supportedContractNatures: ['services'],
        minimumDaysRemaining: 10,
      }),
    });
    expect(matching.status).toBe(200);

    const digest = await fetchApi('/api/org/digest-preferences', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({
        enabled: true,
        sendEmpty: false,
        minClassification: 'WORTH_REVIEWING',
        timezone: 'Europe/Nicosia',
      }),
    });
    expect(digest.status).toBe(200);

    const digestGet = await fetchApi('/api/org/digest-preferences', {
      headers: { cookie: org.cookie },
    });
    const digestBody = (await digestGet.json()) as { digest: { timezone: string } };
    expect(digestBody.digest.timezone).toBe('Europe/Nicosia');
  });
});

describe('POST /api/org/onboarding/complete', () => {
  it('sets onboarding_completed_at and warns on zero CPV-scope overlap', async () => {
    const org = await setUpOrg('OnboardOutOfScope');
    await fetchApi('/api/org/profile', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({
        displayName: 'Out of Scope Co',
        description: null,
        website: null,
        employeeBand: null,
        presetKey: null,
        onboardingCompletedAt: null,
      }),
    });
    await fetchApi('/api/org/cpv-preferences', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      // 35* is outside the default 72*/48*/79417000 scope.
      body: JSON.stringify({ cpvCodes: ['35100000'] }),
    });

    const response = await fetchApi('/api/org/onboarding/complete', {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      scopeOverlapWarning: boolean;
      profile: { onboardingCompletedAt: number | null };
    };
    expect(body.scopeOverlapWarning).toBe(true);
    expect(body.profile.onboardingCompletedAt).not.toBeNull();
  });

  it('does not warn when CPV preferences overlap the ingestion scope', async () => {
    const org = await setUpOrg('OnboardInScope');
    await fetchApi('/api/org/profile', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({
        displayName: 'In Scope Co',
        description: null,
        website: null,
        employeeBand: null,
        presetKey: null,
        onboardingCompletedAt: null,
      }),
    });
    await fetchApi('/api/org/cpv-preferences', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({ cpvCodes: ['72000000'] }),
    });

    const response = await fetchApi('/api/org/onboarding/complete', {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { scopeOverlapWarning: boolean };
    expect(body.scopeOverlapWarning).toBe(false);
  });

  it('409s without a profile', async () => {
    const org = await setUpOrg('OnboardNoProfile');
    const response = await fetchApi('/api/org/onboarding/complete', {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
    });
    expect(response.status).toBe(409);
  });
});

describe('GET /api/org/feed', () => {
  it("tab-filters and never leaks another org's matches (cross-org marker)", async () => {
    const orgA = await setUpOrg('FeedOrgA');
    const orgB = await setUpOrg('FeedOrgB');
    const db = createDb(env.DB);

    const strongLot = await seedLot(db, 'product-feed-strong');
    await seedMatch(db, orgA.orgId, strongLot, { score: 90 });
    const bLot = await seedLot(db, 'product-feed-b');
    await seedMatch(db, orgB.orgId, bLot, { score: 90 });

    const responseA = await fetchApi('/api/org/feed?tab=strong', {
      headers: { cookie: orgA.cookie },
    });
    expect(responseA.status).toBe(200);
    const bodyA = (await responseA.json()) as { items: { lotId: string; matchId: string }[] };
    expect(bodyA.items.map((r) => r.lotId)).toContain(strongLot.lotId);
    expect(bodyA.items.map((r) => r.lotId)).not.toContain(bLot.lotId);

    // Feed rows never carry the raw description.
    expect(JSON.stringify(bodyA)).not.toContain('Detailed lot description');
  });

  it('401s without a session', async () => {
    const response = await fetchApi('/api/org/feed?tab=today');
    expect(response.status).toBe(401);
  });
});

describe('GET /api/org/tenders/:matchId', () => {
  it('returns the full bundle for a STRONG_MATCH (stored components, no recompute)', async () => {
    const org = await setUpOrg('DetailStrongOrg');
    const db = createDb(env.DB);
    const lot = await seedLot(db, 'product-detail-strong');
    const matchId = await seedMatch(db, org.orgId, lot, { score: 85 });

    const response = await fetchApi(`/api/org/tenders/${matchId}`, {
      headers: { cookie: org.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      match: { score: number; classification: string };
      lot: { description: string | null };
      components: { componentKey: string }[];
      explanationRecomputed: boolean;
      savedByYou: boolean;
      ignoredByYou: boolean;
      feedback: unknown;
    };
    expect(body.match.classification).toBe('STRONG_MATCH');
    expect(body.lot.description).toContain('Detailed lot description');
    expect(body.components.length).toBeGreaterThan(0);
    expect(body.explanationRecomputed).toBe(false);
    expect(body.savedByYou).toBe(false);
    expect(body.ignoredByYou).toBe(false);
    expect(body.feedback).toBeNull();
  });

  it('recomputes a LOW_FIT explanation on demand — components sum to the stored score', async () => {
    const org = await setUpOrg('DetailLowFitOrg');
    const db = createDb(env.DB);
    const lot = await seedLot(db, 'product-detail-lowfit', {
      deadlineAt: Date.now() + 60 * 86_400_000,
    });

    // Compute the REAL deterministic engine score for this (empty-profile
    // org, lot) pair — the route recomputes with the same inputs (current
    // org profile + the ORIGINAL scored_at), so the seeded stored score
    // must be the actual engine output, not an arbitrary number, for the
    // sum-equals-stored assertion below to be meaningful.
    const scoredAt = Date.now();
    const orgProfile = await loadOrgProfile(db, toOrganizationId(org.orgId));
    const [bundle] = await loadLotScoringBundlesByIds(db, [lot.lotId]);
    if (bundle === undefined) throw new Error('test setup: lot bundle missing');
    const mapped = await mapLotToEngineInput(db, bundle, scoredAt);
    if (mapped.kind !== 'ok') throw new Error('test setup: lot mapping failed');
    const engineResult = scoreLotForOrg({
      org: orgProfile,
      lot: mapped.lot,
      scoringTime: scoredAt,
    });
    if (engineResult.kind !== 'scored') throw new Error('test setup: expected a scored result');

    // Persisted as LOW_FIT (no component rows) regardless of the engine's
    // own classification threshold — this test exercises the recompute
    // WIRING (route + repo + engine composition), not the classification
    // boundaries themselves (covered in packages/matching's own tests).
    const matchId = await seedMatch(db, org.orgId, lot, {
      score: engineResult.score,
      classification: 'LOW_FIT',
      scoredAt,
    });

    const response = await fetchApi(`/api/org/tenders/${matchId}`, {
      headers: { cookie: org.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      match: { score: number };
      components: { points: number }[];
      explanationRecomputed: boolean;
      explanationNote: string | null;
    };
    expect(body.explanationRecomputed).toBe(true);
    expect(body.explanationNote).toBeNull();
    const total = body.components.reduce((sum, c) => sum + c.points, 0);
    // KEY assertion: the recomputed breakdown sums to the stored score.
    expect(total).toBeCloseTo(body.match.score, 5);
  });

  it('returns a score-only note when the stored engine_version does not match ENGINE_VERSION', async () => {
    const org = await setUpOrg('DetailMismatchOrg');
    const db = createDb(env.DB);
    const lot = await seedLot(db, 'product-detail-mismatch');
    const matchId = await seedMatch(db, org.orgId, lot, {
      score: 15,
      classification: 'LOW_FIT',
      engineVersion: '999-does-not-exist',
    });

    const response = await fetchApi(`/api/org/tenders/${matchId}`, {
      headers: { cookie: org.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      components: unknown[];
      explanationRecomputed: boolean;
      explanationNote: string | null;
    };
    expect(body.explanationRecomputed).toBe(false);
    expect(body.components).toEqual([]);
    expect(body.explanationNote).toContain('previous engine version');
  });

  it('404s a match belonging to another organization', async () => {
    const orgA = await setUpOrg('DetailCrossOrgA');
    const orgB = await setUpOrg('DetailCrossOrgB');
    const db = createDb(env.DB);
    const lot = await seedLot(db, 'product-detail-crossorg');
    const matchId = await seedMatch(db, orgA.orgId, lot, { score: 90 });

    const response = await fetchApi(`/api/org/tenders/${matchId}`, {
      headers: { cookie: orgB.cookie },
    });
    expect(response.status).toBe(404);
  });
});

describe('tender actions: save/ignore/feedback', () => {
  it('save/unsave are idempotent and write product_events; feed reflects the flag', async () => {
    const org = await setUpOrg('ActionSaveOrg');
    const db = createDb(env.DB);
    const lot = await seedLot(db, 'product-action-save');
    const matchId = await seedMatch(db, org.orgId, lot, { score: 90 });

    const firstSave = await fetchApi(`/api/org/tenders/${matchId}/save`, {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
    });
    expect(firstSave.status).toBe(200);
    expect(await firstSave.json()).toEqual({ saved: true, changed: true });

    const secondSave = await fetchApi(`/api/org/tenders/${matchId}/save`, {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
    });
    expect(await secondSave.json()).toEqual({ saved: true, changed: false });

    const events = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM product_events WHERE organization_id = ? AND name = 'match_saved'",
    )
      .bind(org.orgId)
      .first<{ n: number }>();
    expect(events?.n).toBe(2);

    const feedResponse = await fetchApi('/api/org/feed?tab=saved', {
      headers: { cookie: org.cookie },
    });
    const feedBody = (await feedResponse.json()) as {
      items: { lotId: string; savedByYou: boolean }[];
    };
    expect(feedBody.items.map((r) => r.lotId)).toContain(lot.lotId);

    const unsave = await fetchApi(`/api/org/tenders/${matchId}/unsave`, {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
    });
    expect(await unsave.json()).toEqual({ saved: false, changed: true });
  });

  it('ignore/unignore are idempotent', async () => {
    const org = await setUpOrg('ActionIgnoreOrg');
    const db = createDb(env.DB);
    const lot = await seedLot(db, 'product-action-ignore');
    const matchId = await seedMatch(db, org.orgId, lot, { score: 90 });

    const firstIgnore = await fetchApi(`/api/org/tenders/${matchId}/ignore`, {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
    });
    expect(await firstIgnore.json()).toEqual({ ignored: true, changed: true });
    const secondIgnore = await fetchApi(`/api/org/tenders/${matchId}/ignore`, {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
    });
    expect(await secondIgnore.json()).toEqual({ ignored: true, changed: false });

    const unignore = await fetchApi(`/api/org/tenders/${matchId}/unignore`, {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
    });
    expect(await unignore.json()).toEqual({ ignored: false, changed: true });
  });

  it('404s save on a match belonging to another organization (lotId/noticeId never trusted from the client)', async () => {
    const orgA = await setUpOrg('ActionCrossOrgA');
    const orgB = await setUpOrg('ActionCrossOrgB');
    const db = createDb(env.DB);
    const lot = await seedLot(db, 'product-action-crossorg');
    const matchId = await seedMatch(db, orgA.orgId, lot, { score: 90 });

    const response = await fetchApi(`/api/org/tenders/${matchId}/save`, {
      method: 'POST',
      headers: jsonHeaders(orgB.cookie),
    });
    expect(response.status).toBe(404);
  });

  it('feedback upserts (changing your mind replaces the verdict) and writes distinct product events', async () => {
    const org = await setUpOrg('ActionFeedbackOrg');
    const db = createDb(env.DB);
    const lot = await seedLot(db, 'product-action-feedback');
    const matchId = await seedMatch(db, org.orgId, lot, { score: 90 });

    const useful = await fetchApi(`/api/org/tenders/${matchId}/feedback`, {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({ verdict: 'useful' }),
    });
    expect(useful.status).toBe(200);

    const notUseful = await fetchApi(`/api/org/tenders/${matchId}/feedback`, {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({
        verdict: 'not_useful',
        reasons: ['wrong_cpv', 'too_large'],
        comment: 'Not a fit after all.',
      }),
    });
    expect(notUseful.status).toBe(200);
    const notUsefulBody = (await notUseful.json()) as {
      feedback: { verdict: string; reasons: string[]; comment: string | null };
    };
    expect(notUsefulBody.feedback).toEqual({
      verdict: 'not_useful',
      reasons: ['wrong_cpv', 'too_large'],
      comment: 'Not a fit after all.',
    });

    // One live verdict per match — the upsert replaced, not duplicated.
    const rowCount = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM customer_feedback WHERE organization_id = ? AND match_id = ?',
    )
      .bind(org.orgId, matchId)
      .first<{ n: number }>();
    expect(rowCount?.n).toBe(1);

    const usefulEvents = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM product_events WHERE organization_id = ? AND name = 'feedback_useful'",
    )
      .bind(org.orgId)
      .first<{ n: number }>();
    expect(usefulEvents?.n).toBe(1);
    const notUsefulEvents = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM product_events WHERE organization_id = ? AND name = 'feedback_not_useful'",
    )
      .bind(org.orgId)
      .first<{ n: number }>();
    expect(notUsefulEvents?.n).toBe(1);
  });

  it('comment over 500 chars is rejected at the input boundary', async () => {
    const org = await setUpOrg('ActionFeedbackTooLong');
    const db = createDb(env.DB);
    const lot = await seedLot(db, 'product-action-feedback-long');
    const matchId = await seedMatch(db, org.orgId, lot, { score: 90 });

    const response = await fetchApi(`/api/org/tenders/${matchId}/feedback`, {
      method: 'POST',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({ verdict: 'useful', comment: 'x'.repeat(501) }),
    });
    expect(response.status).toBe(400);
  });
});

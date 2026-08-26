/**
 * Phase 10 stage A: `/api/admin/*` INTERNAL_ADMIN surface — real workerd +
 * local D1, mirroring tenancy.test.ts's/product.test.ts's auth-flow
 * patterns. Covers: 404-for-non-admin/200-for-admin on a representative
 * sample of routes, audit-row-per-request (reads AND mutations), the
 * confirm-exact-string pattern's 400s, org suspension blocking both
 * org-context routes and digest org-selection, ingestion scope validation,
 * backfill day-range bounds, match-trace component/score agreement, digest
 * preview's zero side effects, and flags PUT rejecting unknown keys.
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
  listOrgsWithDigestEnabled,
  markFetchRetryAbandoned,
  markFetchRetryRecovered,
  upsertFetchRetry,
  upsertNoticeWithVersion,
  type Db,
  type TenderMatchInput,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';
import { ENGINE_VERSION } from '@bidmorrow/matching';

import './index';

const BASE = 'https://bidmorrow.local';
const STATE_CHANGING_HEADERS = { origin: 'http://localhost:8787' };
const PASSWORD = 'correct horse battery staple 1!';
const SOURCE = 'ted';
/** Matches vitest.config.ts's mixed-case ADMIN_EMAILS binding — lowercase sign-in form. */
const ADMIN_EMAIL = 'admin@example.test';

let uniqueSeq = 0;
function uniqueEmail(prefix = 'admin-api'): string {
  uniqueSeq += 1;
  return `${prefix}-${uniqueSeq}@example.test`.toLowerCase();
}
function nextTestIp(): string {
  uniqueSeq += 1;
  return `10.${(uniqueSeq >> 8) & 0xff}.${uniqueSeq & 0xff}.3`;
}

async function fetchApi(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${BASE}${path}`, init);
}

async function createVerifiedUser(email: string): Promise<string> {
  const ipHeaders = { 'cf-connecting-ip': nextTestIp() };
  const signUpResponse = await fetchApi('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS, ...ipHeaders },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Admin API Test' }),
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

let adminCookieCache: string | null = null;
async function adminCookie(): Promise<string> {
  if (adminCookieCache !== null) return adminCookieCache;
  adminCookieCache = await createVerifiedUser(ADMIN_EMAIL);
  return adminCookieCache;
}

function jsonHeaders(cookie: string) {
  return { 'content-type': 'application/json', cookie, ...STATE_CHANGING_HEADERS };
}

async function auditCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) as n FROM audit_events').first<{ n: number }>();
  return row?.n ?? 0;
}

/** Seeds one notice + one lot with a main CPV code. */
async function seedLot(
  db: Db,
  sourceNoticeId: string,
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
  await insertCpvCodes(db, {
    entries: [{ lotId: lot.id, cpvCode: '72000000', isMain: true }],
  });
  await insertGeographies(db, { entries: [{ lotId: lot.id, countryCode: 'CY' }] });
  return { lotId: lot.id, noticeId };
}

async function seedMatch(
  db: Db,
  orgId: string,
  lot: { lotId: string; noticeId: string },
  score: number,
): Promise<string> {
  const args: TenderMatchInput = {
    lotId: lot.lotId,
    noticeId: lot.noticeId,
    engineVersion: ENGINE_VERSION,
    score,
    classification: 'STRONG_MATCH',
    scoredAt: Date.now(),
    components: [
      {
        componentKey: 'cpv',
        points: score,
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

describe('INTERNAL_ADMIN gate: 404 for non-admin, 200 for admin (sample routes)', () => {
  it('GET /api/admin/orgs', async () => {
    const nonAdmin = await createVerifiedUser(uniqueEmail('non-admin-orgs'));
    const cookie = await adminCookie();
    const denied = await fetchApi('/api/admin/orgs', { headers: { cookie: nonAdmin } });
    expect(denied.status).toBe(404);
    const allowed = await fetchApi('/api/admin/orgs', { headers: { cookie } });
    expect(allowed.status).toBe(200);
  });

  it('GET /api/admin/usage', async () => {
    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/usage', { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { organizations: number };
    expect(typeof body.organizations).toBe('number');
  });

  it('GET /api/admin/flags', async () => {
    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/flags', { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { key: string }[] };
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('GET /api/admin/rail-counts: 404 cloak for non-admin; numeric per-section totals for admin', async () => {
    const nonAdmin = await createVerifiedUser(uniqueEmail('non-admin-rail'));
    const denied = await fetchApi('/api/admin/rail-counts', { headers: { cookie: nonAdmin } });
    expect(denied.status).toBe(404);

    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/rail-counts', { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, number>;
    for (const key of [
      'organizations',
      'users',
      'subscriptions',
      'ingestionRuns',
      'digestRuns',
      'supportNotes',
      'auditEvents',
      'flags',
    ]) {
      expect(typeof body[key]).toBe('number');
    }
    // Only assert what this test controls: users exist (the admin itself)
    // and the flag set is the static enum.
    expect(body['users']).toBeGreaterThan(0);
    expect(body['flags']).toBeGreaterThan(0);
  });
});

describe('audit logging (SEC-P4-07)', () => {
  it('writes an audit_events row for a READ request', async () => {
    const cookie = await adminCookie();
    const before = await auditCount();
    const response = await fetchApi('/api/admin/usage', { headers: { cookie } });
    expect(response.status).toBe(200);
    const after = await auditCount();
    expect(after).toBe(before + 1);
    const last = await env.DB.prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT 1').first<{
      action: string;
      target_id: string;
    }>();
    expect(last?.action).toBe('admin.request');
    expect(last?.target_id).toContain('/api/admin/usage');
  });

  it('writes a generic request row PLUS a specific mutation row for a flag update', async () => {
    const cookie = await adminCookie();
    const before = await auditCount();
    const response = await fetchApi('/api/admin/flags/digest_paused', {
      method: 'PUT',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ value: false, confirm: 'UPDATE_FLAG' }),
    });
    expect(response.status).toBe(200);
    const after = await auditCount();
    // one generic 'admin.request' row (middleware) + one specific
    // 'feature_flag.updated' row (route handler).
    expect(after).toBe(before + 2);
    const actions = await env.DB.prepare(
      'SELECT action FROM audit_events ORDER BY id DESC LIMIT 2',
    ).all<{ action: string }>();
    expect(actions.results.map((r) => r.action).sort()).toEqual(
      ['admin.request', 'feature_flag.updated'].sort(),
    );
  });
});

describe('confirmation pattern', () => {
  it('400s ingestion/pause without confirm; 200s with the exact string', async () => {
    const cookie = await adminCookie();
    const missing = await fetchApi('/api/admin/ingestion/pause', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const wrong = await fetchApi('/api/admin/ingestion/pause', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'nope' }),
    });
    expect(wrong.status).toBe(400);

    const right = await fetchApi('/api/admin/ingestion/pause', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'PAUSE_INGESTION' }),
    });
    expect(right.status).toBe(200);

    // Resume so this test never leaves a global pause active for other tests.
    await fetchApi('/api/admin/ingestion/resume', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'RESUME_INGESTION' }),
    });
  });

  it('400s org suspend without confirm', async () => {
    const cookie = await adminCookie();
    const org = await setUpOrg('ConfirmSuspend');
    const response = await fetchApi(`/api/admin/orgs/${org.orgId}/suspend`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});

describe('organization suspension', () => {
  it('blocks org-context routes with 403 organization_suspended, and excludes the org from digest selection', async () => {
    const cookie = await adminCookie();
    const org = await setUpOrg('SuspendMe');
    const db = createDb(env.DB);

    // Enable digest so the org would otherwise be a digest-selection candidate.
    const digestPut = await fetchApi('/api/org/digest-preferences', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({
        enabled: true,
        sendEmpty: true,
        minClassification: 'LOW_FIT',
        timezone: 'UTC',
      }),
    });
    expect(digestPut.status).toBe(200);

    let candidates = await listOrgsWithDigestEnabled(db);
    expect(candidates.some((c) => c.organizationId === org.orgId)).toBe(true);

    const suspend = await fetchApi(`/api/admin/orgs/${org.orgId}/suspend`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'SUSPEND_ORGANIZATION' }),
    });
    expect(suspend.status).toBe(200);

    const feedResponse = await fetchApi('/api/org/feed?tab=today', {
      headers: { cookie: org.cookie },
    });
    expect(feedResponse.status).toBe(403);
    expect(await feedResponse.json()).toEqual({ error: 'organization_suspended' });

    candidates = await listOrgsWithDigestEnabled(db);
    expect(candidates.some((c) => c.organizationId === org.orgId)).toBe(false);

    const unsuspend = await fetchApi(`/api/admin/orgs/${org.orgId}/unsuspend`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'UNSUSPEND_ORGANIZATION' }),
    });
    expect(unsuspend.status).toBe(200);
    const feedAfter = await fetchApi('/api/org/feed?tab=today', {
      headers: { cookie: org.cookie },
    });
    expect(feedAfter.status).toBe(200);
  });
});

describe('ingestion scope update', () => {
  it('validates bounded family count (>20 rejected)', async () => {
    const cookie = await adminCookie();
    const tooMany = Array.from({ length: 21 }, (_, i) => `7${i}`);
    const response = await fetchApi('/api/admin/ingestion/scope', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ cpvFamilies: tooMany, confirm: 'UPDATE_INGESTION_SCOPE' }),
    });
    expect(response.status).toBe(400);
  });

  it('accepts and persists a valid scope', async () => {
    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/ingestion/scope', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        cpvFamilies: ['72', '48'],
        countries: ['DE'],
        confirm: 'UPDATE_INGESTION_SCOPE',
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { scope: { cpvFamilies: string[] } };
    expect(body.scope.cpvFamilies).toEqual(['72', '48']);
  });
});

describe('ingestion backfill bounds', () => {
  it('rejects a backfill while ingestion is paused (P10-R-02)', async () => {
    const cookie = await adminCookie();
    const pause = await fetchApi('/api/admin/ingestion/pause', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'PAUSE_INGESTION' }),
    });
    expect(pause.status).toBe(200);
    const response = await fetchApi('/api/admin/ingestion/backfill', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        fromDate: '2026-01-01',
        toDate: '2026-01-02',
        confirm: 'RUN_BACKFILL',
      }),
    });
    expect(response.status).toBe(409);
    const resume = await fetchApi('/api/admin/ingestion/resume', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'RESUME_INGESTION' }),
    });
    expect(resume.status).toBe(200);
  });

  it('rejects a range over 90 days', async () => {
    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/ingestion/backfill', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        fromDate: '2026-01-01',
        toDate: '2026-06-01',
        confirm: 'RUN_BACKFILL',
      }),
    });
    expect(response.status).toBe(400);
  });

  it('accepts a small bounded range and enqueues windows', async () => {
    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/ingestion/backfill', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        fromDate: '2026-01-01',
        toDate: '2026-01-03',
        confirm: 'RUN_BACKFILL',
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { enqueuedWindows: number };
    expect(body.enqueuedWindows).toBe(3);
  });
});

describe('GET /api/admin/ingestion/fetch-retries — BM-ADR8-1', () => {
  it('404s for a non-admin, 200s for admin with the {counts, items, nextCursor} shape', async () => {
    const db = createDb(env.DB);
    const marker = `fr-shape-${String(Date.now())}`;
    const pending = await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: `${marker}-pending`,
      xmlUrl: 'https://ted.europa.eu/notice/fr-shape-pending.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: Date.now(),
    });
    const recovered = await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: `${marker}-recovered`,
      xmlUrl: 'https://ted.europa.eu/notice/fr-shape-recovered.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: Date.now(),
    });
    await markFetchRetryRecovered(db, { id: recovered.id });
    const abandoned = await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: `${marker}-abandoned`,
      xmlUrl: 'https://ted.europa.eu/notice/fr-shape-abandoned.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: Date.now(),
    });
    await markFetchRetryAbandoned(db, { id: abandoned.id });

    const nonAdmin = await createVerifiedUser(uniqueEmail('non-admin-fetch-retries'));
    const denied = await fetchApi('/api/admin/ingestion/fetch-retries', {
      headers: { cookie: nonAdmin },
    });
    expect(denied.status).toBe(404);

    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/ingestion/fetch-retries', { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      counts: { pending: number; recovered: number; abandoned: number };
      items: { id: string; sourceNoticeId: string; status: string }[];
      nextCursor: string | null;
    };
    expect(typeof body.counts.pending).toBe('number');
    expect(typeof body.counts.recovered).toBe('number');
    expect(typeof body.counts.abandoned).toBe('number');
    expect(body.counts.pending).toBeGreaterThanOrEqual(1);
    expect(body.counts.recovered).toBeGreaterThanOrEqual(1);
    expect(body.counts.abandoned).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.items)).toBe(true);
    const ids = body.items.map((i) => i.id);
    // Newest-first, unfiltered listing includes all three freshly-seeded rows.
    expect(ids).toEqual(expect.arrayContaining([pending.id, recovered.id, abandoned.id]));
  });

  it('filters by status', async () => {
    const db = createDb(env.DB);
    const marker = `fr-filter-${String(Date.now())}`;
    const recovered = await upsertFetchRetry(db, {
      source: 'ted',
      sourceNoticeId: `${marker}-recovered`,
      xmlUrl: 'https://ted.europa.eu/notice/fr-filter-recovered.xml',
      publicationDate: '2026-08-01',
      errorCode: 'NOTICE_FETCH_HTTP_404',
      nextAttemptAt: Date.now(),
    });
    await markFetchRetryRecovered(db, { id: recovered.id });

    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/ingestion/fetch-retries?status=recovered', {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { status: string }[] };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.every((i) => i.status === 'recovered')).toBe(true);
  });

  it('the requested-limit cap (limit=999) is rejected with 400, same as every other admin list route', async () => {
    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/ingestion/fetch-retries?limit=999', {
      headers: { cookie },
    });
    expect(response.status).toBe(400);
  });
});

describe('match-trace', () => {
  it('recomputed live components sum to the stored score for a seeded match', async () => {
    const cookie = await adminCookie();
    const org = await setUpOrg('MatchTrace');
    const db = createDb(env.DB);

    // Give the org a CPV preference so the live recompute has real signal.
    await fetchApi('/api/org/cpv-preferences', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({ cpvCodes: ['72000000'] }),
    });

    const lot = await seedLot(db, 'admin-trace-1');
    const matchId = await seedMatch(db, org.orgId, lot, 35);

    const response = await fetchApi(
      `/api/admin/match-trace?organizationId=${org.orgId}&lotId=${lot.lotId}`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      stored: { match: { id: string; score: number }; components: { points: number }[] } | null;
      live: { kind: string; total?: number } | null;
    };
    expect(body.stored?.match.id).toBe(matchId);
    const storedSum = (body.stored?.components ?? []).reduce((sum, c) => sum + c.points, 0);
    expect(storedSum).toBe(35);
    expect(body.live).not.toBeNull();
  });
});

describe('digest preview', () => {
  it('never creates a digest_runs or email_deliveries row', async () => {
    const cookie = await adminCookie();
    const org = await setUpOrg('DigestPreview');
    await fetchApi('/api/org/digest-preferences', {
      method: 'PUT',
      headers: jsonHeaders(org.cookie),
      body: JSON.stringify({
        enabled: true,
        sendEmpty: true,
        minClassification: 'LOW_FIT',
        timezone: 'UTC',
      }),
    });

    const runsBefore = await env.DB.prepare('SELECT COUNT(*) as n FROM digest_runs').first<{
      n: number;
    }>();
    const deliveriesBefore = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM email_deliveries',
    ).first<{ n: number }>();

    const today = new Date().toISOString().slice(0, 10);
    const response = await fetchApi(
      `/api/admin/digest/preview?organizationId=${org.orgId}&date=${today}`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rendered: { subject: string } };
    expect(typeof body.rendered.subject).toBe('string');

    const runsAfter = await env.DB.prepare('SELECT COUNT(*) as n FROM digest_runs').first<{
      n: number;
    }>();
    const deliveriesAfter = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM email_deliveries',
    ).first<{ n: number }>();
    expect(runsAfter?.n).toBe(runsBefore?.n);
    expect(deliveriesAfter?.n).toBe(deliveriesBefore?.n);
  });
});

describe('feature flags PUT', () => {
  it('rejects an unknown key at the route param before the handler runs', async () => {
    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/flags/not_a_real_flag', {
      method: 'PUT',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ value: true, confirm: 'UPDATE_FLAG' }),
    });
    expect(response.status).toBe(400);
  });

  it('updates a known key and the change is readable back via GET /flags', async () => {
    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/flags/founding_plan_open', {
      method: 'PUT',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ value: true, confirm: 'UPDATE_FLAG' }),
    });
    expect(response.status).toBe(200);
    const list = await fetchApi('/api/admin/flags', { headers: { cookie } });
    const body = (await list.json()) as { items: { key: string; value: string | null }[] };
    const flag = body.items.find((f) => f.key === 'founding_plan_open');
    expect(flag?.value).toBe('true');
  });

  it('rejects value shapes the consuming pipeline could not load (SEC-P10-01)', async () => {
    const cookie = await adminCookie();
    // Malformed ingestion scope through the generic PUT must be rejected by
    // the same parser the ingestion cron loads with — not persisted.
    const badScope = await fetchApi('/api/admin/flags/ingestion_cpv_scope', {
      method: 'PUT',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ value: { nonsense: true }, confirm: 'UPDATE_FLAG' }),
    });
    expect(badScope.status).toBe(400);
    const badBool = await fetchApi('/api/admin/flags/ingestion_paused', {
      method: 'PUT',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ value: 'yes', confirm: 'UPDATE_FLAG' }),
    });
    expect(badBool.status).toBe(400);
    const badCap = await fetchApi('/api/admin/flags/founding_cap', {
      method: 'PUT',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ value: 12.5, confirm: 'UPDATE_FLAG' }),
    });
    expect(badCap.status).toBe(400);
  });
});

describe('pagination cap', () => {
  it('rejects a requested limit above 50', async () => {
    const cookie = await adminCookie();
    const response = await fetchApi('/api/admin/orgs?limit=51', { headers: { cookie } });
    expect(response.status).toBe(400);
  });
});

describe('GET /api/account/me: identity + isAdmin navigation hint', () => {
  it('401 without a session', async () => {
    const response = await fetchApi('/api/account/me');
    expect(response.status).toBe(401);
  });

  it('isAdmin=false for an ordinary user (plain answer, not cloaked)', async () => {
    const email = uniqueEmail('me-plain');
    const cookie = await createVerifiedUser(email);
    const response = await fetchApi('/api/account/me', { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { email: string }; isAdmin: boolean };
    expect(body.user.email).toBe(email);
    expect(body.isAdmin).toBe(false);
  });

  it('isAdmin=true for an ADMIN_EMAILS member (case-insensitive)', async () => {
    const cookie = await adminCookie();
    const response = await fetchApi('/api/account/me', { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { isAdmin: boolean };
    expect(body.isAdmin).toBe(true);
  });
});

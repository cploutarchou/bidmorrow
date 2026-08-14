/**
 * SEC-P3-04 (hard requirement, docs/security.md C6): endpoint-level tenant
 * isolation tests for `/api/org/*`, `/api/admin/*`, and `DELETE
 * /api/account`, running end-to-end in real workerd + local D1 (mirrors
 * auth.test.ts's pattern). Two independent users/orgs (A, B) throughout;
 * every cross-tenant/escalation attempt is asserted to fail, and every
 * write is verified against the repository layer directly (not just the
 * HTTP response) so a handler that "looks right" but writes to the wrong
 * row cannot pass silently.
 */
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createDb, getCompanyProfile, listCompanyKeywords } from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';

import './index';

const BASE = 'https://bidmorrow.local';
const STATE_CHANGING_HEADERS = { origin: 'http://localhost:8787' };
const PASSWORD = 'correct horse battery staple 1!';

let uniqueSeq = 0;
/**
 * Better Auth normalizes emails to lowercase on sign-up/sign-in (verified
 * behaviorally below) — generate lowercase addresses so the raw D1
 * `UPDATE ... WHERE email = ?` used to force-verify in tests actually
 * matches the stored row.
 */
function uniqueEmail(prefix = 'tenancy'): string {
  uniqueSeq += 1;
  return `${prefix}-${uniqueSeq}@example.test`.toLowerCase();
}

/**
 * Better Auth's own database-storage rate limiter (docs/security.md C7)
 * applies a strict 3-requests/10s rule to sign-up/sign-in, keyed by client
 * IP (`x-forwarded-for`, verified from installed
 * `@better-auth/core/dist/utils/ip.mjs`). Without a forwarded-IP header
 * every test request would share one bucket and throttle each other after
 * 3 sign-ups — give each test-created user its own IP so this suite's
 * volume doesn't trip Better Auth's own abuse protection.
 */
function nextTestIp(): string {
  uniqueSeq += 1;
  return `10.${(uniqueSeq >> 8) & 0xff}.${uniqueSeq & 0xff}.1`;
}

async function fetchApi(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${BASE}${path}`, init);
}

/** Signs up, force-verifies the email directly in D1, signs in, returns the session cookie. */
async function createVerifiedUser(email: string): Promise<string> {
  const ipHeaders = { 'x-forwarded-for': nextTestIp() };
  const signUpResponse = await fetchApi('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS, ...ipHeaders },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Tenancy Test' }),
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
  expect(setCookie).toBeTruthy();
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

/** A fully set-up org: verified user + org + a distinguishing profile marker. */
async function setUpOrg(label: string): Promise<{ cookie: string; orgId: string; email: string }> {
  const email = uniqueEmail(label);
  const cookie = await createVerifiedUser(email);
  const orgId = await createOrgForUser(cookie, `${label} Org`);
  const put = await fetchApi('/api/org/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie, ...STATE_CHANGING_HEADERS },
    body: JSON.stringify({
      displayName: `MARKER-${label}`,
      description: null,
      website: null,
      employeeBand: null,
      presetKey: null,
      onboardingCompletedAt: null,
    }),
  });
  expect(put.status).toBe(200);
  return { cookie, orgId, email };
}

describe('SEC-P3-04: /api/org/* requires authentication', () => {
  it('401s every /api/org/* endpoint without a session', async () => {
    const requests: [string, RequestInit][] = [
      [
        '/api/org',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS },
          body: '{"name":"x"}',
        },
      ],
      ['/api/org/profile', {}],
      [
        '/api/org/profile',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS },
          body: '{}',
        },
      ],
      ['/api/org/keywords', {}],
      [
        '/api/org/keywords',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS },
          body: '{"keywords":[]}',
        },
      ],
    ];
    for (const [path, init] of requests) {
      const response = await fetchApi(path, init);
      expect(response.status, `${(init.method as string) ?? 'GET'} ${path}`).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthenticated' });
    }
  });

  it('404s /api/admin/* without a session (existence never revealed)', async () => {
    const response = await fetchApi('/api/admin/health-details');
    expect(response.status).toBe(404);
  });
});

describe('SEC-P3-04: cross-org read/write isolation', () => {
  it("B's GET /api/org/profile never returns A's data, and B's write never touches A's row", async () => {
    const orgA = await setUpOrg('OrgA');
    const orgB = await setUpOrg('OrgB');

    const getB = await fetchApi('/api/org/profile', { headers: { cookie: orgB.cookie } });
    expect(getB.status).toBe(200);
    const bodyB = await getB.json();
    const serializedB = JSON.stringify(bodyB);
    expect(serializedB).toContain('MARKER-OrgB');
    expect(serializedB).not.toContain('MARKER-OrgA');

    // Cross-org write attempt: B updates its own profile; verify via the
    // repository layer directly that A's row is byte-for-byte unchanged.
    const db = createDb(env.DB);
    const before = await getCompanyProfile(db, toOrganizationId(orgA.orgId));

    const putB = await fetchApi('/api/org/profile', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: orgB.cookie,
        ...STATE_CHANGING_HEADERS,
      },
      body: JSON.stringify({
        displayName: 'MARKER-OrgB-updated',
        description: null,
        website: null,
        employeeBand: null,
        presetKey: null,
        onboardingCompletedAt: null,
      }),
    });
    expect(putB.status).toBe(200);

    const after = await getCompanyProfile(db, toOrganizationId(orgA.orgId));
    expect(after).toEqual(before);

    const bUpdated = await getCompanyProfile(db, toOrganizationId(orgB.orgId));
    expect(bUpdated?.displayName).toBe('MARKER-OrgB-updated');
  });

  it('no client-supplied organizationId (query string or JSON body) can redirect a write to another org', async () => {
    const orgA = await setUpOrg('QueryOrgA');
    const orgB = await setUpOrg('QueryOrgB');
    const db = createDb(env.DB);
    const beforeA = await getCompanyProfile(db, toOrganizationId(orgA.orgId));

    // Query string: GET never reads it — org is resolved from the session only.
    const getWithQuery = await fetchApi(`/api/org/profile?organizationId=${orgA.orgId}`, {
      headers: { cookie: orgB.cookie },
    });
    expect(getWithQuery.status).toBe(200);
    const bodyWithQuery = await getWithQuery.json();
    expect(JSON.stringify(bodyWithQuery)).toContain('MARKER-QueryOrgB');
    expect(JSON.stringify(bodyWithQuery)).not.toContain('MARKER-QueryOrgA');

    // JSON body: the profile schema is a closed (`.strict()`) object, so an
    // unrecognized `organizationId` field is rejected at the input boundary
    // rather than silently honored — a stronger guarantee than "ignored":
    // it cannot influence tenant scoping under any code path. Confirmed A
    // untouched either way.
    const putWithBodyOrgId = await fetchApi(`/api/org/profile?organizationId=${orgA.orgId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: orgB.cookie,
        ...STATE_CHANGING_HEADERS,
      },
      body: JSON.stringify({
        organizationId: orgA.orgId,
        displayName: 'MARKER-QueryOrgB-updated',
        description: null,
        website: null,
        employeeBand: null,
        presetKey: null,
        onboardingCompletedAt: null,
      }),
    });
    expect(putWithBodyOrgId.status).toBe(400);

    const afterA = await getCompanyProfile(db, toOrganizationId(orgA.orgId));
    expect(afterA).toEqual(beforeA);
  });
});

describe('SEC-P3-04: role escalation', () => {
  it('a MEMBER (non-owner) gets 403 on PUT /api/org/profile', async () => {
    const owner = await setUpOrg('MemberOrg');
    const memberEmail = uniqueEmail('member');
    const memberCookie = await createVerifiedUser(memberEmail);

    // Seed the MEMBER row directly via the repository layer (no invite UI
    // in V1 — docs/architecture-decisions/0007).
    const { addOrganizationMember } = await import('@bidmorrow/db');
    const db = createDb(env.DB);
    const memberUserRow = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(memberEmail)
      .first<{ id: string }>();
    if (memberUserRow === null) throw new Error('test setup: member user row missing');
    await addOrganizationMember(db, toOrganizationId(owner.orgId), {
      userId: memberUserRow.id,
      role: 'MEMBER',
    });

    const getAsMember = await fetchApi('/api/org/profile', { headers: { cookie: memberCookie } });
    expect(getAsMember.status).toBe(200);

    const putAsMember = await fetchApi('/api/org/profile', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: memberCookie,
        ...STATE_CHANGING_HEADERS,
      },
      body: JSON.stringify({
        displayName: 'should-not-be-allowed',
        description: null,
        website: null,
        employeeBand: null,
        presetKey: null,
        onboardingCompletedAt: null,
      }),
    });
    expect(putAsMember.status).toBe(403);
    expect(await putAsMember.json()).toEqual({ error: 'forbidden' });
  });
});

describe('SEC-P3-04: INTERNAL_ADMIN gate', () => {
  it('404s a normal (non-allowlisted) user; 200s the ADMIN_EMAILS user', async () => {
    const normal = await createVerifiedUser(uniqueEmail('non-admin'));
    const normalResponse = await fetchApi('/api/admin/health-details', {
      headers: { cookie: normal },
    });
    expect(normalResponse.status).toBe(404);

    // Matches the ADMIN_EMAILS test binding in vitest.config.ts.
    const adminCookie = await createVerifiedUser('admin@example.test');
    const adminResponse = await fetchApi('/api/admin/health-details', {
      headers: { cookie: adminCookie },
    });
    expect(adminResponse.status).toBe(200);
    expect(await adminResponse.json()).toEqual({ ok: true, admin: true });
  });
});

describe('SEC-P3-04: keyword cap', () => {
  it('replacing with 51 keywords returns 422 cap_exceeded', async () => {
    const org = await setUpOrg('CapOrg');
    const keywords = Array.from({ length: 51 }, (_, i) => ({
      kind: 'positive' as const,
      term: `keyword-${i}`,
    }));
    const response = await fetchApi('/api/org/keywords', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: org.cookie,
        ...STATE_CHANGING_HEADERS,
      },
      body: JSON.stringify({ keywords }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'cap_exceeded', cap: 50 });

    const db = createDb(env.DB);
    const stored = await listCompanyKeywords(db, toOrganizationId(org.orgId), { limit: 100 });
    expect(stored.items).toEqual([]);
  });
});

describe('SEC-P3-04: account deletion', () => {
  it('409s a sole-OWNER user; deletes a memberless user and invalidates their session', async () => {
    const owner = await setUpOrg('DeleteOwnerOrg');
    const soleOwnerDelete = await fetchApi('/api/account', {
      method: 'DELETE',
      headers: { cookie: owner.cookie, ...STATE_CHANGING_HEADERS },
    });
    expect(soleOwnerDelete.status).toBe(409);
    expect(await soleOwnerDelete.json()).toEqual({
      error: 'transfer_or_delete_organization_first',
    });

    const memberlessEmail = uniqueEmail('memberless');
    const memberlessCookie = await createVerifiedUser(memberlessEmail);
    const memberlessDelete = await fetchApi('/api/account', {
      method: 'DELETE',
      headers: { cookie: memberlessCookie, ...STATE_CHANGING_HEADERS },
    });
    expect(memberlessDelete.status).toBe(204);

    const userRow = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(memberlessEmail)
      .first();
    expect(userRow).toBeNull();

    const afterDeleteRequest = await fetchApi('/api/org/profile', {
      headers: { cookie: memberlessCookie },
    });
    expect(afterDeleteRequest.status).toBe(401);
  });
});

/**
 * No-login digest unsubscribe (F-08, PRODUCTION_READINESS_AUDIT.md): real
 * workerd + local D1 over the actual HTTP surface, because the properties
 * that matter here are properties of the ROUTE — that GET never mutates,
 * that a forged token cannot disable another organization's digest, and
 * that the whole thing works with no session cookie at all.
 */
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
  createDb,
  createOrganization,
  getDigestPreferences,
  listAuditEventsAdmin,
  newId,
  schema,
  upsertDigestPreferences,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';
import { signUnsubscribeToken } from '@bidmorrow/notifications';

const BASE = 'http://localhost';

/** Matches vitest.config.ts's binding — the value the route verifies against. */
const SECRET = env.BETTER_AUTH_SECRET;

let seq = 0;

/** Same shape as digest.d1.test.ts's seeder — a user plus their organization. */
async function seedOrg(): Promise<string> {
  seq += 1;
  const db = createDb(env.DB);
  const userId = newId(Date.now());
  await db.insert(schema.users).values({
    id: userId,
    email: `unsub-test-${String(seq)}@example.test`,
    emailVerified: true,
    name: `Unsub Tester ${String(seq)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const { organization } = await createOrganization(db, {
    name: `Unsub Test Org ${String(seq)}`,
    createdByUserId: userId,
  });
  return organization.id;
}

async function seedOrgWithDigest(): Promise<{ orgId: string; email: string }> {
  const db = createDb(env.DB);
  const orgId = await seedOrg();
  await upsertDigestPreferences(db, toOrganizationId(orgId), {
    enabled: true,
    sendEmpty: false,
    minClassification: 'POSSIBLE_MATCH',
    timezone: 'Europe/Nicosia',
  });
  return { orgId, email: `recipient-${orgId}@example.test` };
}

async function digestEnabled(orgId: string): Promise<boolean> {
  const prefs = await getDigestPreferences(createDb(env.DB), toOrganizationId(orgId));
  return prefs?.enabled === 1;
}

function unsubscribe(token: string, method: 'GET' | 'POST'): Promise<Response> {
  return exports.default.fetch(
    `${BASE}/api/digest/unsubscribe?token=${encodeURIComponent(token)}`,
    { method },
  );
}

describe('GET /api/digest/unsubscribe', () => {
  it('renders a confirmation page and changes NOTHING (mail scanners follow links)', async () => {
    const { orgId, email } = await seedOrgWithDigest();
    const token = await signUnsubscribeToken(SECRET, { organizationId: orgId, email });

    const response = await unsubscribe(token, 'GET');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain(email);
    expect(body).toContain('<form method="post"');
    // The whole point of the GET/POST split.
    expect(await digestEnabled(orgId)).toBe(true);
  });

  it('rejects a forged token with a generic 400', async () => {
    const response = await unsubscribe('forged.payload', 'GET');
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('not valid');
  });
});

describe('POST /api/digest/unsubscribe', () => {
  it('disables the digest with no session and writes an audit event', async () => {
    const { orgId, email } = await seedOrgWithDigest();
    const token = await signUnsubscribeToken(SECRET, { organizationId: orgId, email });

    const response = await unsubscribe(token, 'POST');

    expect(response.status).toBe(200);
    expect(await digestEnabled(orgId)).toBe(false);

    const audit = await listAuditEventsAdmin(createDb(env.DB), { limit: 50 });
    const event = audit.items.find(
      (row) => row.organizationId === orgId && row.action === 'digest.unsubscribed',
    );
    expect(event).toBeDefined();
    expect(event?.actorType).toBe('system');
    expect(event?.beforeSummary).toBe('enabled');
    // SEC-UNSUB-01: audit_events is append-only, kept 24 months, and survives
    // org purge and tombstoning — so the recipient address must NOT be here.
    // email_deliveries (12 months, purged with the org) is the correlatable
    // copy.
    expect(event?.afterSummary).not.toContain(email);
    expect(event?.afterSummary).not.toContain('@');
  });

  it('preserves the other digest preferences — it only flips `enabled`', async () => {
    const { orgId, email } = await seedOrgWithDigest();
    const token = await signUnsubscribeToken(SECRET, { organizationId: orgId, email });

    await unsubscribe(token, 'POST');

    const prefs = await getDigestPreferences(createDb(env.DB), toOrganizationId(orgId));
    expect(prefs?.timezone).toBe('Europe/Nicosia');
    expect(prefs?.minClassification).toBe('POSSIBLE_MATCH');
    expect(prefs?.sendEmpty).toBe(0);
  });

  it('is idempotent — a provider retry or a second click still answers 200', async () => {
    const { orgId, email } = await seedOrgWithDigest();
    const token = await signUnsubscribeToken(SECRET, { organizationId: orgId, email });

    expect((await unsubscribe(token, 'POST')).status).toBe(200);
    expect((await unsubscribe(token, 'POST')).status).toBe(200);
    expect(await digestEnabled(orgId)).toBe(false);

    // Exactly one audit event: the no-op second call must not log a second
    // "unsubscribed" that never happened.
    const audit = await listAuditEventsAdmin(createDb(env.DB), { limit: 50 });
    const events = audit.items.filter(
      (row) => row.organizationId === orgId && row.action === 'digest.unsubscribed',
    );
    expect(events).toHaveLength(1);
  });

  it('a token forged for another organization cannot disable its digest', async () => {
    const victim = await seedOrgWithDigest();
    const attacker = await seedOrgWithDigest();

    // The attacker holds a VALID token for their own org and rewrites the
    // payload to name the victim, keeping the original MAC.
    const ownToken = await signUnsubscribeToken(SECRET, {
      organizationId: attacker.orgId,
      email: attacker.email,
    });
    const forgedPayload = btoa(JSON.stringify({ o: victim.orgId, e: attacker.email }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const forged = `${forgedPayload}.${ownToken.slice(ownToken.indexOf('.') + 1)}`;

    const response = await unsubscribe(forged, 'POST');

    expect(response.status).toBe(400);
    expect(await digestEnabled(victim.orgId)).toBe(true);
  });

  it('answers 200 for an org that never had digest preferences', async () => {
    const orgId = await seedOrg();
    const token = await signUnsubscribeToken(SECRET, {
      organizationId: orgId,
      email: 'nobody@example.test',
    });

    // Nothing to turn off is not a failure the recipient can act on.
    expect((await unsubscribe(token, 'POST')).status).toBe(200);
  });
});

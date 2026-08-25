/**
 * Billing integration tests (ADR-0011, Paddle): real workerd + local D1
 * (@cloudflare/vitest-pool-workers), Paddle SANDBOX sentinels only (never
 * real credentials — HUMAN_DECISION_BLOCKERS.md item 4).
 *
 * Two tiers, deliberately split:
 *
 * 1. HTTP-level (`/api/billing/*`, `/api/webhooks/paddle`) — everything
 *    reachable WITHOUT a real network call to Paddle: guard paths that
 *    short-circuit before any Paddle API call (409 existing-subscription,
 *    409 founding-unavailable, 404 no-billing-customer, role/auth gates,
 *    malformed ids), webhook signature verification (pure local HMAC via
 *    `signPaddleWebhook` — no network either), idempotent replay, and the
 *    entitlement enforcement flag gating `/api/org/feed`. The route
 *    handlers build their own real Paddle client from `c.env.PADDLE_*`
 *    (vitest.config.ts's fake sentinels), so a code path that would
 *    actually REACH Paddle's network (a successful checkout transaction,
 *    the invoice PDF lookup, the webhook's `subscriptions.get` re-fetch)
 *    is deliberately not exercised at this layer — packages/billing's unit
 *    tests cover those with injected fakes.
 * 2. Direct `processPaddleEvent` calls (tier 2, below) — bypasses the HTTP
 *    layer, calling `@bidmorrow/billing`'s processor with a real local-D1
 *    `db` and a FAKE, hand-written Paddle client (no network). This is
 *    where idempotent-duplicate, out-of-order (state-always-from-re-fetch),
 *    unknown-type-ack, failure-then-retry, the cross-org
 *    `TenantMismatchError` guard, and SEC-P9-03 reconciliation are proven.
 */
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  isFoundingPlanAvailable,
  processPaddleEvent,
  signOrganizationProvenance,
  signPaddleWebhook,
  type PaddleEvent,
  type PaddleSubscription,
  type SubscriptionsReadClient,
} from '@bidmorrow/billing';
import {
  addOrganizationMember,
  createDb,
  getBillingEventByProviderId,
  getSubscription,
  setFeatureFlag,
  upsertSubscriptionByBillingCustomerId,
  type Db,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';

import './index';

const BASE = 'https://bidmorrow.local';
const STATE_CHANGING_HEADERS = { origin: 'http://localhost:8787' };
const PASSWORD = 'correct horse battery staple 1!';

// Sandbox sentinels only — mirrors vitest.config.ts's fake bindings.
const TEST_WEBHOOK_SECRET = 'pdl_ntfset_fake_for_worker_tests_only';
const TEST_FOUNDING_PRICE = 'pri_01fakefoundingtest00000000';
const TEST_STANDARD_PRICE = 'pri_01fakestandardtest00000000';

let uniqueSeq = 0;
function uniqueEmail(prefix = 'billing'): string {
  uniqueSeq += 1;
  return `${prefix}-${String(uniqueSeq)}@example.test`.toLowerCase();
}
function nextTestIp(): string {
  uniqueSeq += 1;
  return `10.${String((uniqueSeq >> 8) & 0xff)}.${String(uniqueSeq & 0xff)}.3`;
}

async function fetchApi(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${BASE}${path}`, init);
}

async function createVerifiedUser(email: string): Promise<string> {
  const ipHeaders = { 'cf-connecting-ip': nextTestIp() };
  const signUpResponse = await fetchApi('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS, ...ipHeaders },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Billing Test' }),
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

async function addMember(orgId: string, email: string): Promise<string> {
  const cookie = await createVerifiedUser(email);
  const db = createDb(env.DB);
  const userRow = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();
  if (userRow === null) throw new Error('test setup: member user row missing');
  await addOrganizationMember(db, toOrganizationId(orgId), { userId: userRow.id, role: 'MEMBER' });
  return cookie;
}

let seedSeq = 0;
async function seedSubscription(
  db: Db,
  orgId: string,
  overrides: Partial<{
    status: 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
    plan: 'founding' | 'standard';
    currentPeriodEndAt: number | null;
  }> = {},
) {
  seedSeq += 1;
  return upsertSubscriptionByBillingCustomerId(db, toOrganizationId(orgId), {
    billingCustomerId: `ctm_test_${String(seedSeq)}`,
    billingSubscriptionId: `sub_test_${String(seedSeq)}`,
    status: overrides.status ?? 'active',
    plan: overrides.plan ?? 'standard',
    currentPeriodEndAt: overrides.currentPeriodEndAt ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
    cancelAtPeriodEnd: false,
  });
}

async function billingEventCount(providerEventId: string): Promise<number> {
  const count = await env.DB.prepare(
    'SELECT COUNT(*) as n FROM billing_events WHERE provider_event_id = ?',
  )
    .bind(providerEventId)
    .first<{ n: number }>();
  return count?.n ?? 0;
}

describe('GET /api/billing/status', () => {
  it('reports no_subscription when the org has never checked out', async () => {
    const { cookie } = await setUpOrg('StatusNone');
    const response = await fetchApi('/api/billing/status', { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      entitlement: { active: false, plan: null, status: null, reason: 'no_subscription' },
      subscription: null,
    });
  });

  it('reflects a seeded active subscription, including tax-exclusive price + paymentState', async () => {
    const { cookie, orgId } = await setUpOrg('StatusActive');
    const db = createDb(env.DB);
    await seedSubscription(db, orgId, { status: 'active', plan: 'founding' });

    const response = await fetchApi('/api/billing/status', { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      entitlement: { active: true, plan: 'founding', status: 'active', reason: 'active' },
      subscription: {
        plan: 'founding',
        status: 'active',
        cancelAtPeriodEnd: false,
        paymentState: 'active',
        price: { amountMinorUnits: 2900, currency: 'eur', interval: 'month', taxExclusive: true },
      },
    });
  });

  it('reflects the standard plan price and a past_due paymentState', async () => {
    const { cookie, orgId } = await setUpOrg('StatusStandardPastDue');
    const db = createDb(env.DB);
    await seedSubscription(db, orgId, { status: 'past_due', plan: 'standard' });

    const response = await fetchApi('/api/billing/status', { headers: { cookie } });
    const body = await response.json();
    expect(body).toMatchObject({
      subscription: {
        plan: 'standard',
        status: 'past_due',
        paymentState: 'past_due',
        price: { amountMinorUnits: 4900, currency: 'eur', interval: 'month' },
      },
    });
  });

  it('a paused subscription is stored as paused and is NOT entitled', async () => {
    const { cookie, orgId } = await setUpOrg('StatusPaused');
    const db = createDb(env.DB);
    await seedSubscription(db, orgId, { status: 'paused' });

    const response = await fetchApi('/api/billing/status', { headers: { cookie } });
    const body = await response.json();
    expect(body).toMatchObject({
      entitlement: { active: false, status: 'paused', reason: 'paused' },
      subscription: { status: 'paused', paymentState: 'paused' },
    });
  });

  it("never leaks another organization's subscription (cross-org isolation)", async () => {
    const orgA = await setUpOrg('StatusIsoA');
    const orgB = await setUpOrg('StatusIsoB');
    const db = createDb(env.DB);
    await seedSubscription(db, orgA.orgId, { status: 'active', plan: 'standard' });

    const responseB = await fetchApi('/api/billing/status', { headers: { cookie: orgB.cookie } });
    const bodyB = await responseB.json();
    expect(bodyB).toMatchObject({ subscription: null });

    const responseA = await fetchApi('/api/billing/status', { headers: { cookie: orgA.cookie } });
    const bodyA = await responseA.json();
    expect(bodyA).toMatchObject({ subscription: { plan: 'standard' } });
  });

  it('foundingAvailable reflects the flag/cap state', async () => {
    const { cookie } = await setUpOrg('StatusFounding');
    const db = createDb(env.DB);

    const closed = await fetchApi('/api/billing/status', { headers: { cookie } });
    const closedBody = (await closed.json()) as { foundingAvailable: boolean };
    expect(closedBody.foundingAvailable).toBe(false);

    await setFeatureFlag(db, {
      key: 'founding_plan_open',
      valueJson: 'true',
      description: 'test: open founding plan',
    });
    const open = await fetchApi('/api/billing/status', { headers: { cookie } });
    const openBody = (await open.json()) as { foundingAvailable: boolean };
    expect(openBody.foundingAvailable).toBe(true);

    await setFeatureFlag(db, {
      key: 'founding_cap',
      valueJson: '0',
      description: 'test: close founding via zero cap',
    });
    const capped = await fetchApi('/api/billing/status', { headers: { cookie } });
    const cappedBody = (await capped.json()) as { foundingAvailable: boolean };
    expect(cappedBody.foundingAvailable).toBe(false);

    expect(await isFoundingPlanAvailable(db)).toBe(false);
  });
});

describe('GET /api/public-config', () => {
  it('exposes ONLY the public Paddle.js token + environment, never the API key or price ids', async () => {
    const response = await fetchApi('/api/public-config');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      paddle: { clientToken: 'test_fake_client_token', environment: 'sandbox' },
    });
    expect(text).not.toContain('pdl_sdbx_apikey');
    expect(text).not.toContain('pdl_ntfset');
    expect(text).not.toContain('pri_fake');
  });
});

describe('POST /api/billing/checkout', () => {
  it('401s when unauthenticated', async () => {
    const response = await fetchApi('/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS },
      body: JSON.stringify({ plan: 'standard' }),
    });
    expect(response.status).toBe(401);
  });

  it('403s for a MEMBER (non-owner)', async () => {
    const owner = await setUpOrg('CheckoutMember');
    const memberCookie = await addMember(owner.orgId, uniqueEmail('checkout-member'));

    const response = await fetchApi('/api/billing/checkout', {
      method: 'POST',
      headers: jsonHeaders(memberCookie),
      body: JSON.stringify({ plan: 'standard' }),
    });
    expect(response.status).toBe(403);
  });

  it('409s when the org already has a non-canceled subscription (before any Paddle call)', async () => {
    const { cookie, orgId } = await setUpOrg('CheckoutExisting');
    const db = createDb(env.DB);
    await seedSubscription(db, orgId, { status: 'active' });

    const response = await fetchApi('/api/billing/checkout', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ plan: 'standard' }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'subscription_exists' });
  });

  it('409s when the org has a PAUSED subscription — it still holds the slot', async () => {
    const { cookie, orgId } = await setUpOrg('CheckoutPaused');
    const db = createDb(env.DB);
    await seedSubscription(db, orgId, { status: 'paused' });

    const response = await fetchApi('/api/billing/checkout', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ plan: 'standard' }),
    });
    expect(response.status).toBe(409);
  });

  it('409s founding_unavailable (flag_closed) before any Paddle call', async () => {
    const { cookie } = await setUpOrg('CheckoutFoundingClosed');
    const db = createDb(env.DB);
    // Global flags are shared across this file's tests (one D1 per file) —
    // explicitly close the flag rather than relying on the absent default.
    await setFeatureFlag(db, {
      key: 'founding_plan_open',
      valueJson: 'false',
      description: 'test: explicitly close founding plan',
    });
    const response = await fetchApi('/api/billing/checkout', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ plan: 'founding' }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'founding_unavailable', reason: 'flag_closed' });
  });

  it('409s founding_unavailable (cap_reached) before any Paddle call', async () => {
    const { cookie } = await setUpOrg('CheckoutFoundingCap');
    const db = createDb(env.DB);
    await setFeatureFlag(db, {
      key: 'founding_plan_open',
      valueJson: 'true',
      description: 'test: open founding plan',
    });
    await setFeatureFlag(db, {
      key: 'founding_cap',
      valueJson: '0',
      description: 'test: zero cap',
    });
    const response = await fetchApi('/api/billing/checkout', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ plan: 'founding' }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'founding_unavailable', reason: 'cap_reached' });
  });
});

describe('POST /api/billing/portal', () => {
  it('403s for a MEMBER (non-owner)', async () => {
    const owner = await setUpOrg('PortalMember');
    const memberCookie = await addMember(owner.orgId, uniqueEmail('portal-member'));
    const response = await fetchApi('/api/billing/portal', {
      method: 'POST',
      headers: jsonHeaders(memberCookie),
    });
    expect(response.status).toBe(403);
  });

  it('404s (no_billing_customer) before any Paddle call when the org has never checked out', async () => {
    const { cookie } = await setUpOrg('PortalNoCustomer');
    const response = await fetchApi('/api/billing/portal', {
      method: 'POST',
      headers: jsonHeaders(cookie),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'no_billing_customer' });
  });
});

async function auditEventCount(organizationId: string, action: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) as n FROM audit_events WHERE organization_id = ? AND action = ?',
  )
    .bind(organizationId, action)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('GET /api/billing/invoices', () => {
  it('401s when unauthenticated', async () => {
    const response = await fetchApi('/api/billing/invoices');
    expect(response.status).toBe(401);
  });

  it('403s for a MEMBER (non-owner)', async () => {
    const owner = await setUpOrg('InvoicesMember');
    const memberCookie = await addMember(owner.orgId, uniqueEmail('invoices-member'));
    const response = await fetchApi('/api/billing/invoices', { headers: { cookie: memberCookie } });
    expect(response.status).toBe(403);
  });

  it('200s with an empty list + hasBillingCustomer:false before any Paddle call when the org has never checked out, and audit-logs the access', async () => {
    const { cookie, orgId } = await setUpOrg('InvoicesNoCustomer');
    const response = await fetchApi('/api/billing/invoices', { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invoices: [], hasBillingCustomer: false });
    expect(await auditEventCount(orgId, 'billing.invoices_viewed')).toBe(1);
  });

  it("never leaks another organization's billing-customer state (cross-org isolation)", async () => {
    const orgA = await setUpOrg('InvoicesIsoA');
    const orgB = await setUpOrg('InvoicesIsoB');
    const db = createDb(env.DB);
    await seedSubscription(db, orgA.orgId, { status: 'active' });

    const responseB = await fetchApi('/api/billing/invoices', { headers: { cookie: orgB.cookie } });
    expect(await responseB.json()).toEqual({ invoices: [], hasBillingCustomer: false });
  });
});

describe('GET /api/billing/invoices/:transactionId/pdf', () => {
  const VALID_SHAPE = 'txn_01h1vjes1y163xfj1rh1tkfb65';

  it('401s when unauthenticated', async () => {
    const response = await fetchApi(`/api/billing/invoices/${VALID_SHAPE}/pdf`);
    expect(response.status).toBe(401);
  });

  it('403s for a MEMBER (non-owner)', async () => {
    const owner = await setUpOrg('PdfMember');
    const memberCookie = await addMember(owner.orgId, uniqueEmail('pdf-member'));
    const response = await fetchApi(`/api/billing/invoices/${VALID_SHAPE}/pdf`, {
      headers: { cookie: memberCookie },
    });
    expect(response.status).toBe(403);
  });

  it('400s a malformed transaction id before any Paddle call (zod)', async () => {
    const { cookie } = await setUpOrg('PdfMalformed');
    for (const bad of ['not-a-txn', 'txn_short', 'sub_01h1vjes1y163xfj1rh1tkfb65', 'txn_%2E%2E']) {
      const response = await fetchApi(`/api/billing/invoices/${bad}/pdf`, {
        headers: { cookie },
      });
      expect(response.status, bad).toBe(400);
    }
  });

  it('404s before any Paddle call when the org has never checked out', async () => {
    const { cookie } = await setUpOrg('PdfNoCustomer');
    const response = await fetchApi(`/api/billing/invoices/${VALID_SHAPE}/pdf`, {
      headers: { cookie },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});

describe('POST /api/billing/cancel', () => {
  it('401s when unauthenticated', async () => {
    const response = await fetchApi('/api/billing/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS },
      body: JSON.stringify({ confirm: 'CANCEL_SUBSCRIPTION' }),
    });
    expect(response.status).toBe(401);
  });

  it('403s for a MEMBER (non-owner)', async () => {
    const owner = await setUpOrg('CancelMember');
    const memberCookie = await addMember(owner.orgId, uniqueEmail('cancel-member'));
    const response = await fetchApi('/api/billing/cancel', {
      method: 'POST',
      headers: jsonHeaders(memberCookie),
      body: JSON.stringify({ confirm: 'CANCEL_SUBSCRIPTION' }),
    });
    expect(response.status).toBe(403);
  });

  it('400s on a missing/incorrect confirm literal (zod)', async () => {
    const { cookie } = await setUpOrg('CancelBadBody');
    const wrongLiteral = await fetchApi('/api/billing/cancel', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'yes' }),
    });
    expect(wrongLiteral.status).toBe(400);

    const missing = await fetchApi('/api/billing/cancel', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
  });

  it('409s no_subscription when the org has never checked out', async () => {
    const { cookie, orgId } = await setUpOrg('CancelNoSub');
    const response = await fetchApi('/api/billing/cancel', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'CANCEL_SUBSCRIPTION' }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'no_subscription' });
    expect(await auditEventCount(orgId, 'billing.subscription_cancel_scheduled')).toBe(0);
  });

  it('409s already_canceled when the subscription is fully canceled', async () => {
    const { cookie, orgId } = await setUpOrg('CancelAlreadyCanceled');
    const db = createDb(env.DB);
    await seedSubscription(db, orgId, { status: 'canceled' });

    const response = await fetchApi('/api/billing/cancel', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'CANCEL_SUBSCRIPTION' }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'already_canceled' });
  });

  it('200s idempotently (no Paddle call, no new audit row) when already scheduled to cancel', async () => {
    const { cookie, orgId } = await setUpOrg('CancelAlreadyScheduled');
    const db = createDb(env.DB);
    const seeded = await seedSubscription(db, orgId, {
      status: 'active',
      currentPeriodEndAt: 1_800_000_000_000,
    });
    await upsertSubscriptionByBillingCustomerId(db, toOrganizationId(orgId), {
      billingCustomerId: seeded.billingCustomerId,
      billingSubscriptionId: seeded.billingSubscriptionId,
      status: 'active',
      plan: 'standard',
      currentPeriodEndAt: 1_800_000_000_000,
      cancelAtPeriodEnd: true,
    });

    const response = await fetchApi('/api/billing/cancel', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'CANCEL_SUBSCRIPTION' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cancelAtPeriodEnd: true,
      currentPeriodEndAt: 1_800_000_000_000,
      effective: 'period_end',
    });
    expect(await auditEventCount(orgId, 'billing.subscription_cancel_scheduled')).toBe(0);
  });
});

describe('POST /api/billing/reactivate', () => {
  it('401s when unauthenticated', async () => {
    const response = await fetchApi('/api/billing/reactivate', {
      method: 'POST',
      headers: STATE_CHANGING_HEADERS,
    });
    expect(response.status).toBe(401);
  });

  it('403s for a MEMBER (non-owner)', async () => {
    const owner = await setUpOrg('ReactivateMember');
    const memberCookie = await addMember(owner.orgId, uniqueEmail('reactivate-member'));
    const response = await fetchApi('/api/billing/reactivate', {
      method: 'POST',
      headers: jsonHeaders(memberCookie),
    });
    expect(response.status).toBe(403);
  });

  it('409s no_subscription (requiresCheckout: true) when the org has never checked out', async () => {
    const { cookie } = await setUpOrg('ReactivateNoSub');
    const response = await fetchApi('/api/billing/reactivate', {
      method: 'POST',
      headers: jsonHeaders(cookie),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'no_subscription', requiresCheckout: true });
  });

  it('409s already_canceled (requiresCheckout: true) when fully canceled', async () => {
    const { cookie, orgId } = await setUpOrg('ReactivateAlreadyCanceled');
    const db = createDb(env.DB);
    await seedSubscription(db, orgId, { status: 'canceled' });

    const response = await fetchApi('/api/billing/reactivate', {
      method: 'POST',
      headers: jsonHeaders(cookie),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'already_canceled', requiresCheckout: true });
  });

  it('409s not_scheduled when the subscription is active but not scheduled to cancel', async () => {
    const { cookie, orgId } = await setUpOrg('ReactivateNotScheduled');
    const db = createDb(env.DB);
    await seedSubscription(db, orgId, { status: 'active' });

    const response = await fetchApi('/api/billing/reactivate', {
      method: 'POST',
      headers: jsonHeaders(cookie),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'not_scheduled' });
    expect(await auditEventCount(orgId, 'billing.subscription_reactivated')).toBe(0);
  });

  it.each(['past_due', 'paused'] as const)(
    '409s not_scheduled for a %s subscription even if cancelAtPeriodEnd is set',
    async (status) => {
      const { cookie, orgId } = await setUpOrg(`Reactivate_${status}`);
      const db = createDb(env.DB);
      const seeded = await seedSubscription(db, orgId, { status });
      await upsertSubscriptionByBillingCustomerId(db, toOrganizationId(orgId), {
        billingCustomerId: seeded.billingCustomerId,
        billingSubscriptionId: seeded.billingSubscriptionId,
        status,
        plan: 'standard',
        currentPeriodEndAt: seeded.currentPeriodEndAt,
        cancelAtPeriodEnd: true,
      });

      const response = await fetchApi('/api/billing/reactivate', {
        method: 'POST',
        headers: jsonHeaders(cookie),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'not_scheduled' });
    },
  );
});

describe('ENTITLEMENT_ENFORCED gating on GET /api/org/feed', () => {
  it('flag off (default): feed is reachable with no subscription (V1-pilot mode)', async () => {
    const { cookie } = await setUpOrg('FeedGateOff');
    const response = await fetchApi('/api/org/feed?tab=today', { headers: { cookie } });
    expect(response.status).toBe(200);
  });

  it('flag on + no active subscription: 402 subscription_required', async () => {
    const { cookie } = await setUpOrg('FeedGateOnInactive');
    const db = createDb(env.DB);
    await setFeatureFlag(db, {
      key: 'entitlement_enforced',
      valueJson: 'true',
      description: 'test: enforce entitlement',
    });
    const response = await fetchApi('/api/org/feed?tab=today', { headers: { cookie } });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: 'subscription_required',
      reason: 'no_subscription',
    });
  });

  it('flag on + paused subscription: 402 with reason paused', async () => {
    const { cookie, orgId } = await setUpOrg('FeedGateOnPaused');
    const db = createDb(env.DB);
    await setFeatureFlag(db, {
      key: 'entitlement_enforced',
      valueJson: 'true',
      description: 'test: enforce entitlement',
    });
    await seedSubscription(db, orgId, { status: 'paused' });
    const response = await fetchApi('/api/org/feed?tab=today', { headers: { cookie } });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: 'subscription_required', reason: 'paused' });
  });

  it('flag on + active subscription: feed is reachable', async () => {
    const { cookie, orgId } = await setUpOrg('FeedGateOnActive');
    const db = createDb(env.DB);
    await setFeatureFlag(db, {
      key: 'entitlement_enforced',
      valueJson: 'true',
      description: 'test: enforce entitlement',
    });
    await seedSubscription(db, orgId, { status: 'active' });
    const response = await fetchApi('/api/org/feed?tab=today', { headers: { cookie } });
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Webhook HTTP endpoint — signature verification (pure local HMAC, no
// network), idempotent replay.
// ---------------------------------------------------------------------------

async function signedWebhookRequest(payload: string, secret: string = TEST_WEBHOOK_SECRET) {
  const signature = await signPaddleWebhook(secret, payload);
  return fetchApi('/api/webhooks/paddle', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'paddle-signature': signature },
    body: payload,
  });
}

function unhandledEventPayload(id: string): string {
  // A real Paddle event shape, but a type deliberately OUTSIDE the
  // subscribed/handled set (`isHandledEvent`) — proves the endpoint
  // records + ack's it without ever needing a `subscriptions.get`
  // network call (which this test tier cannot make — see file header).
  return JSON.stringify({
    event_id: id,
    event_type: 'transaction.completed',
    occurred_at: '2026-08-25T12:00:00.000Z',
    notification_id: `ntf_${id}`,
    data: { id: 'txn_01h1vjes1y163xfj1rh1tkfb65', status: 'completed' },
  });
}

describe('POST /api/webhooks/paddle', () => {
  it('400s with no row when the signature header is missing', async () => {
    const payload = unhandledEventPayload('evt_missing_sig');
    const response = await fetchApi('/api/webhooks/paddle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    expect(response.status).toBe(400);
    const db = createDb(env.DB);
    expect(await getBillingEventByProviderId(db, 'evt_missing_sig')).toBeNull();
  });

  it('400s with no row when the signature was made with a different secret', async () => {
    const payload = unhandledEventPayload('evt_bad_sig');
    const response = await signedWebhookRequest(payload, 'pdl_ntfset_totally_wrong_secret');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_signature' });
    const db = createDb(env.DB);
    expect(await getBillingEventByProviderId(db, 'evt_bad_sig')).toBeNull();
  });

  it('400s with no row when the body was tampered with after signing', async () => {
    const payload = unhandledEventPayload('evt_tampered');
    const signature = await signPaddleWebhook(TEST_WEBHOOK_SECRET, payload);
    const response = await fetchApi('/api/webhooks/paddle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'paddle-signature': signature },
      body: payload.replace('"completed"', '"paid"'),
    });
    expect(response.status).toBe(400);
    const db = createDb(env.DB);
    expect(await getBillingEventByProviderId(db, 'evt_tampered')).toBeNull();
  });

  it('400s with no row when the signature timestamp is outside the tolerance window (replay)', async () => {
    const payload = unhandledEventPayload('evt_stale_ts');
    const staleTs = Math.floor(Date.now() / 1000) - 60 * 60;
    const signature = await signPaddleWebhook(TEST_WEBHOOK_SECRET, payload, staleTs);
    const response = await fetchApi('/api/webhooks/paddle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'paddle-signature': signature },
      body: payload,
    });
    expect(response.status).toBe(400);
    const db = createDb(env.DB);
    expect(await getBillingEventByProviderId(db, 'evt_stale_ts')).toBeNull();
  });

  it('a valid signature processes an unhandled-type event: 200 + exactly one ignored row', async () => {
    const payload = unhandledEventPayload('evt_valid_unhandled');
    const response = await signedWebhookRequest(payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    const db = createDb(env.DB);
    const row = await getBillingEventByProviderId(db, 'evt_valid_unhandled');
    expect(row?.status).toBe('ignored');
    expect(row?.type).toBe('transaction.completed');
  });

  it('replaying the same event id is idempotent: 200 + single row, no duplicate insert', async () => {
    const payload = unhandledEventPayload('evt_replay');
    const first = await signedWebhookRequest(payload);
    expect(first.status).toBe(200);
    const second = await signedWebhookRequest(payload);
    expect(second.status).toBe(200);
    expect(await billingEventCount('evt_replay')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tier 2: direct `processPaddleEvent` calls with a FAKE injected Paddle
// client (real local D1, zero network) — idempotency, out-of-order
// (re-fetch, never payload), unknown type, failure-then-retry, tenant
// guard, SEC-P9-03 reconciliation.
// ---------------------------------------------------------------------------

function fakeSubscription(
  overrides: Partial<PaddleSubscription> & { id: string; customer_id: string },
): PaddleSubscription {
  return {
    status: 'active',
    custom_data: null,
    current_billing_period: {
      starts_at: '2026-08-01T00:00:00.000Z',
      ends_at: '2026-09-01T00:00:00.000Z',
    },
    next_billed_at: '2026-09-01T00:00:00.000Z',
    scheduled_change: null,
    items: [{ price: { id: TEST_STANDARD_PRICE } }],
    ...overrides,
  };
}

/**
 * A fake `SubscriptionsReadClient` whose `get` is scriptable per-call, so
 * tests can prove re-fetch (never payload) drives the stored state.
 * `cancel` calls are recorded (never reach Paddle — zero-network) so
 * SEC-P9-03 reconciliation tests can assert exactly which subscription id
 * got canceled and how.
 */
function makeFakePaddle(getImpl: (id: string) => Promise<PaddleSubscription>): {
  subscriptions: SubscriptionsReadClient;
  getCallCount: number;
  cancelCalls: { id: string; body: { effective_from: string } }[];
} {
  const fake = {
    getCallCount: 0,
    cancelCalls: [] as { id: string; body: { effective_from: string } }[],
    subscriptions: {
      async get(id: string) {
        fake.getCallCount += 1;
        return getImpl(id);
      },
      async cancel(id: string, body: { effective_from: 'next_billing_period' | 'immediately' }) {
        fake.cancelCalls.push({ id, body });
        return fakeSubscription({ id, customer_id: 'ctm_canceled', status: 'canceled' });
      },
    },
  };
  return fake;
}

async function subscriptionEvent(args: {
  id: string;
  type: string;
  organizationId: string | null;
  subscriptionId: string;
  /** Deliberately possibly-stale payload status — the processor must ignore this and re-fetch. */
  payloadStatus?: string;
  /** Omit the provenance signature (SEC-PDL-01 forgery case). Default: signed like checkout.ts writes it. */
  unsigned?: boolean;
}): Promise<PaddleEvent> {
  const customData =
    args.organizationId === null
      ? null
      : args.unsigned === true
        ? { organization_id: args.organizationId, plan: 'standard' }
        : {
            organization_id: args.organizationId,
            organization_sig: await signOrganizationProvenance(
              TEST_WEBHOOK_SECRET,
              args.organizationId,
            ),
            plan: 'standard',
          };
  return {
    event_id: args.id,
    event_type: args.type,
    occurred_at: '2026-08-25T12:00:00.000Z',
    notification_id: `ntf_${args.id}`,
    data: {
      id: args.subscriptionId,
      status: args.payloadStatus ?? 'active',
      customer_id: 'ctm_payload_never_trusted',
      custom_data: customData,
      items: [{ price: { id: TEST_STANDARD_PRICE } }],
      current_billing_period: null,
      scheduled_change: null,
    },
  };
}

const PRICE_IDS = { founding: TEST_FOUNDING_PRICE, standard: TEST_STANDARD_PRICE };
const DEPS_BASE = { priceIds: PRICE_IDS, provenanceSecret: TEST_WEBHOOK_SECRET };

describe('processPaddleEvent (fake Paddle client, real D1)', () => {
  it('subscription.created re-fetches and upserts, firing subscription_started once', async () => {
    const { orgId } = await setUpOrg('WebhookCreated');
    const db = createDb(env.DB);
    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: 'ctm_created_1', status: 'active' }),
    );
    const event = await subscriptionEvent({
      id: 'evt_created_1',
      type: 'subscription.created',
      organizationId: orgId,
      subscriptionId: 'sub_created_1',
    });

    const outcome = await processPaddleEvent({ db, paddle, ...DEPS_BASE }, event);
    expect(outcome).toBe('processed');

    const subscription = await getSubscription(db, toOrganizationId(orgId));
    expect(subscription).toMatchObject({
      status: 'active',
      plan: 'standard',
      billingCustomerId: 'ctm_created_1',
      billingSubscriptionId: 'sub_created_1',
      currentPeriodEndAt: Date.parse('2026-09-01T00:00:00.000Z'),
      cancelAtPeriodEnd: 0,
    });

    const started = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM product_events WHERE organization_id = ? AND name = 'subscription_started'",
    )
      .bind(orgId)
      .first<{ n: number }>();
    expect(started?.n).toBe(1);
  });

  it('a scheduled cancel on the re-fetched entity is mirrored as cancelAtPeriodEnd', async () => {
    const { orgId } = await setUpOrg('WebhookScheduledCancel');
    const db = createDb(env.DB);
    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({
        id,
        customer_id: 'ctm_sched_1',
        status: 'active',
        scheduled_change: {
          action: 'cancel',
          effective_at: '2026-09-01T00:00:00.000Z',
          resume_at: null,
        },
      }),
    );
    const outcome = await processPaddleEvent(
      { db, paddle, ...DEPS_BASE },
      await subscriptionEvent({
        id: 'evt_sched_1',
        type: 'subscription.updated',
        organizationId: orgId,
        subscriptionId: 'sub_sched_1',
      }),
    );
    expect(outcome).toBe('processed');
    const row = await getSubscription(db, toOrganizationId(orgId));
    expect(row).toMatchObject({ status: 'active', cancelAtPeriodEnd: 1 });
  });

  it('idempotent duplicate delivery: single processing, single re-fetch call', async () => {
    const { orgId } = await setUpOrg('WebhookDuplicate');
    const db = createDb(env.DB);
    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: 'ctm_dup_1', status: 'active' }),
    );
    const event = await subscriptionEvent({
      id: 'evt_duplicate_1',
      type: 'subscription.activated',
      organizationId: orgId,
      subscriptionId: 'sub_dup_1',
    });

    const first = await processPaddleEvent({ db, paddle, ...DEPS_BASE }, event);
    const second = await processPaddleEvent({ db, paddle, ...DEPS_BASE }, event);
    expect(first).toBe('processed');
    expect(second).toBe('duplicate');
    expect(paddle.getCallCount).toBe(1);
    expect(await billingEventCount('evt_duplicate_1')).toBe(1);
  });

  it('out-of-order delivery: stored state always comes from the re-fetch, never the payload', async () => {
    const { orgId } = await setUpOrg('WebhookOutOfOrder');
    const db = createDb(env.DB);
    const seedPaddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: 'ctm_ooo_1', status: 'active' }),
    );
    await processPaddleEvent(
      { db, paddle: seedPaddle, ...DEPS_BASE },
      await subscriptionEvent({
        id: 'evt_ooo_newer',
        type: 'subscription.created',
        organizationId: orgId,
        subscriptionId: 'sub_ooo_1',
      }),
    );

    // An "older" `subscription.canceled` arrives AFTER, with a payload
    // claiming `canceled` — but the live re-fetch still reports `active`.
    const stalePaddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: 'ctm_ooo_1', status: 'active' }),
    );
    const outcome = await processPaddleEvent(
      { db, paddle: stalePaddle, ...DEPS_BASE },
      await subscriptionEvent({
        id: 'evt_ooo_older',
        type: 'subscription.canceled',
        organizationId: orgId,
        subscriptionId: 'sub_ooo_1',
        payloadStatus: 'canceled',
      }),
    );
    expect(outcome).toBe('processed');

    const subscription = await getSubscription(db, toOrganizationId(orgId));
    expect(subscription?.status).toBe('active');
  });

  it('unknown event type: ack without ever calling Paddle', async () => {
    await setUpOrg('WebhookUnknown');
    const db = createDb(env.DB);
    const paddle = makeFakePaddle(async () => {
      throw new Error('must never be called for an unhandled event type');
    });
    const event: PaddleEvent = {
      event_id: 'evt_unknown_type',
      event_type: 'transaction.paid',
      occurred_at: '2026-08-25T12:00:00.000Z',
      data: { id: 'txn_01h1vjes1y163xfj1rh1tkfb65' },
    };

    const outcome = await processPaddleEvent({ db, paddle, ...DEPS_BASE }, event);
    expect(outcome).toBe('ignored');
    expect(paddle.getCallCount).toBe(0);

    const row = await getBillingEventByProviderId(db, 'evt_unknown_type');
    expect(row?.status).toBe('ignored');
  });

  it('SEC-PDL-01: a forged UNSIGNED organization_id is ignored — one ignored row with organization null, no subscription', async () => {
    const { orgId } = await setUpOrg('WebhookForgedUnsigned');
    const db = createDb(env.DB);
    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({
        id,
        customer_id: 'ctm_forged',
        status: 'active',
        custom_data: { organization_id: orgId, plan: 'standard' },
      }),
    );
    const outcome = await processPaddleEvent(
      { db, paddle, ...DEPS_BASE },
      await subscriptionEvent({
        id: 'evt_forged_unsigned',
        type: 'subscription.created',
        organizationId: orgId,
        subscriptionId: 'sub_forged_unsigned',
        unsigned: true,
      }),
    );
    expect(outcome).toBe('ignored');
    expect(await billingEventCount('evt_forged_unsigned')).toBe(1);
    const row = await getBillingEventByProviderId(db, 'evt_forged_unsigned');
    expect(row?.status).toBe('ignored');
    expect(row?.organizationId).toBeNull();
    expect(await getSubscription(db, toOrganizationId(orgId))).toBeNull();
  });

  it('SEC-PDL-01: an unsigned custom_data naming a NON-EXISTENT org never becomes an FK write (no throw)', async () => {
    await setUpOrg('WebhookForgedGhost');
    const db = createDb(env.DB);
    const ghost = 'org_does_not_exist_01J0GHOST';
    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({
        id,
        customer_id: 'ctm_ghost',
        status: 'active',
        custom_data: { organization_id: ghost, plan: 'standard' },
      }),
    );
    const outcome = await processPaddleEvent(
      { db, paddle, ...DEPS_BASE },
      await subscriptionEvent({
        id: 'evt_forged_ghost',
        type: 'subscription.created',
        organizationId: ghost,
        subscriptionId: 'sub_forged_ghost',
        unsigned: true,
      }),
    );
    expect(outcome).toBe('ignored');
    const row = await getBillingEventByProviderId(db, 'evt_forged_ghost');
    expect(row?.status).toBe('ignored');
    expect(row?.organizationId).toBeNull();
  });

  it('handled type with no resolvable organization (no custom_data anywhere): ignored, nothing written', async () => {
    await setUpOrg('WebhookUnresolvable');
    const db = createDb(env.DB);
    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: 'ctm_orphan', status: 'active', custom_data: null }),
    );
    const outcome = await processPaddleEvent(
      { db, paddle, ...DEPS_BASE },
      await subscriptionEvent({
        id: 'evt_orphan',
        type: 'subscription.created',
        organizationId: null,
        subscriptionId: 'sub_orphan',
      }),
    );
    expect(outcome).toBe('ignored');
    const row = await getBillingEventByProviderId(db, 'evt_orphan');
    expect(row?.status).toBe('ignored');
    expect(row?.organizationId).toBeNull();
  });

  it('unknown price id (our env misconfigured): fails loudly so Paddle retries, never acks silently', async () => {
    const { orgId } = await setUpOrg('WebhookUnknownPrice');
    const db = createDb(env.DB);
    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({
        id,
        customer_id: 'ctm_badprice',
        items: [{ price: { id: 'pri_not_ours' } }],
      }),
    );
    await expect(
      processPaddleEvent(
        { db, paddle, ...DEPS_BASE },
        await subscriptionEvent({
          id: 'evt_badprice',
          type: 'subscription.created',
          organizationId: orgId,
          subscriptionId: 'sub_badprice',
        }),
      ),
    ).rejects.toThrow(/unknown Paddle price id/);
    const row = await getBillingEventByProviderId(db, 'evt_badprice');
    expect(row?.status).toBe('failed');
    expect(await getSubscription(db, toOrganizationId(orgId))).toBeNull();
  });

  it('failure-then-retry: a failed attempt is retried (not treated as a duplicate) and can succeed', async () => {
    const { orgId } = await setUpOrg('WebhookRetry');
    const db = createDb(env.DB);
    const event = await subscriptionEvent({
      id: 'evt_retry_1',
      type: 'subscription.created',
      organizationId: orgId,
      subscriptionId: 'sub_retry_1',
    });

    const failingPaddle = makeFakePaddle(async () => {
      throw new Error('simulated transient Paddle API failure');
    });
    await expect(
      processPaddleEvent({ db, paddle: failingPaddle, ...DEPS_BASE }, event),
    ).rejects.toThrow('simulated transient Paddle API failure');
    const failedRow = await getBillingEventByProviderId(db, 'evt_retry_1');
    expect(failedRow?.status).toBe('failed');

    const succeedingPaddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: 'ctm_retry_1', status: 'active' }),
    );
    const outcome = await processPaddleEvent({ db, paddle: succeedingPaddle, ...DEPS_BASE }, event);
    expect(outcome).toBe('processed');

    const finalRow = await getBillingEventByProviderId(db, 'evt_retry_1');
    expect(finalRow?.status).toBe('processed');
    expect(await billingEventCount('evt_retry_1')).toBe(1);
  });

  it('tenant guard: an event resolving to org A never mutates a billing_customer_id already owned by org B', async () => {
    const orgA = await setUpOrg('WebhookTenantA');
    const orgB = await setUpOrg('WebhookTenantB');
    const db = createDb(env.DB);
    await seedSubscription(db, orgB.orgId, { status: 'active' });
    const existingB = await getSubscription(db, toOrganizationId(orgB.orgId));
    if (existingB === null) throw new Error('test setup: org B subscription missing');

    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: existingB.billingCustomerId, status: 'active' }),
    );
    const event = await subscriptionEvent({
      id: 'evt_tenant_mismatch',
      type: 'subscription.created',
      organizationId: orgA.orgId,
      subscriptionId: 'sub_tenant_mismatch',
    });

    await expect(processPaddleEvent({ db, paddle, ...DEPS_BASE }, event)).rejects.toThrow();

    const row = await getBillingEventByProviderId(db, 'evt_tenant_mismatch');
    expect(row?.status).toBe('failed');
    expect(await getSubscription(db, toOrganizationId(orgA.orgId))).toBeNull();
    const untouchedB = await getSubscription(db, toOrganizationId(orgB.orgId));
    expect(untouchedB?.organizationId).toBe(orgB.orgId);
    expect(untouchedB?.billingSubscriptionId).toBe(existingB.billingSubscriptionId);
  });

  // SEC-P9-03: concurrent double-checkout reconciliation.
  it('duplicate non-canceled customer: cancels the duplicate immediately, records the event, keeps the existing row untouched', async () => {
    const { orgId } = await setUpOrg('WebhookDupNonCanceled');
    const db = createDb(env.DB);
    const kept = await seedSubscription(db, orgId, { status: 'active' });

    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: 'ctm_double_checkout', status: 'active' }),
    );
    const event = await subscriptionEvent({
      id: 'evt_double_checkout',
      type: 'subscription.created',
      organizationId: orgId,
      subscriptionId: 'sub_double_checkout',
    });

    const outcome = await processPaddleEvent({ db, paddle, ...DEPS_BASE }, event);
    expect(outcome).toBe('duplicate_reconciled');

    expect(paddle.cancelCalls).toEqual([
      { id: 'sub_double_checkout', body: { effective_from: 'immediately' } },
    ]);

    const row = await getBillingEventByProviderId(db, 'evt_double_checkout');
    expect(row?.status).toBe('processed');

    const after = await getSubscription(db, toOrganizationId(orgId));
    expect(after).toMatchObject({
      billingCustomerId: kept.billingCustomerId,
      billingSubscriptionId: kept.billingSubscriptionId,
      status: 'active',
    });
  });

  it('same-customer re-delivery (a different event id for the SAME customer) updates the existing row normally, no reconciliation', async () => {
    const { orgId } = await setUpOrg('WebhookSameCustomer');
    const db = createDb(env.DB);
    const seeded = await seedSubscription(db, orgId, { status: 'active' });

    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: seeded.billingCustomerId, status: 'past_due' }),
    );
    const event = await subscriptionEvent({
      id: 'evt_same_customer_update',
      type: 'subscription.past_due',
      organizationId: orgId,
      subscriptionId: seeded.billingSubscriptionId ?? 'sub_missing',
      payloadStatus: 'past_due',
    });

    const outcome = await processPaddleEvent({ db, paddle, ...DEPS_BASE }, event);
    expect(outcome).toBe('processed');
    expect(paddle.cancelCalls).toEqual([]);

    const after = await getSubscription(db, toOrganizationId(orgId));
    expect(after).toMatchObject({
      billingCustomerId: seeded.billingCustomerId,
      status: 'past_due',
    });
  });

  it('canceled-row reactivation: a new subscription on the SAME (reused) customer updates the row, no reconciliation', async () => {
    const { orgId } = await setUpOrg('WebhookReactivate');
    const db = createDb(env.DB);
    const canceled = await seedSubscription(db, orgId, { status: 'canceled' });

    // Mirrors checkout.ts's real reactivation flow: a canceled row's
    // customer id is passed as the transaction's `customer_id`, so the
    // reactivating subscription is a NEW subscription id on the SAME
    // customer — never a brand-new customer.
    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: canceled.billingCustomerId, status: 'active' }),
    );
    const event = await subscriptionEvent({
      id: 'evt_reactivate',
      type: 'subscription.created',
      organizationId: orgId,
      subscriptionId: 'sub_reactivated',
    });

    const outcome = await processPaddleEvent({ db, paddle, ...DEPS_BASE }, event);
    expect(outcome).toBe('processed');
    expect(paddle.cancelCalls).toEqual([]);

    const after = await getSubscription(db, toOrganizationId(orgId));
    expect(after).toMatchObject({
      billingCustomerId: canceled.billingCustomerId,
      billingSubscriptionId: 'sub_reactivated',
      status: 'active',
    });
  });

  it('transition to canceled fires subscription_canceled once', async () => {
    const { orgId } = await setUpOrg('WebhookCanceledEvent');
    const db = createDb(env.DB);
    const seeded = await seedSubscription(db, orgId, { status: 'active' });
    const paddle = makeFakePaddle(async (id) =>
      fakeSubscription({ id, customer_id: seeded.billingCustomerId, status: 'canceled' }),
    );
    const outcome = await processPaddleEvent(
      { db, paddle, ...DEPS_BASE },
      await subscriptionEvent({
        id: 'evt_canceled_transition',
        type: 'subscription.canceled',
        organizationId: orgId,
        subscriptionId: seeded.billingSubscriptionId ?? 'sub_missing',
        payloadStatus: 'canceled',
      }),
    );
    expect(outcome).toBe('processed');
    const canceled = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM product_events WHERE organization_id = ? AND name = 'subscription_canceled'",
    )
      .bind(orgId)
      .first<{ n: number }>();
    expect(canceled?.n).toBe(1);
  });
});

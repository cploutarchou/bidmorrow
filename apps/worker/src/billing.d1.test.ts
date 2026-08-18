/**
 * Billing (Phase 9) integration tests: real workerd + local D1
 * (@cloudflare/vitest-pool-workers), Stripe test-mode sentinels only (never
 * real credentials — HUMAN_DECISION_BLOCKERS.md item 4).
 *
 * Two tiers, deliberately split:
 *
 * 1. HTTP-level (`/api/billing/*`, `/api/webhooks/stripe`) — everything
 *    reachable WITHOUT a real network call to Stripe: guard paths that
 *    short-circuit before any Stripe API call (409 existing-subscription,
 *    409 founding-unavailable, 404 no-billing-customer, role/auth gates),
 *    webhook signature verification (pure local HMAC via
 *    `stripe.webhooks.constructEventAsync`/`generateTestHeaderStringAsync`
 *    — no network either), idempotent replay, and the entitlement
 *    enforcement flag gating `/api/org/feed`. The route handlers build
 *    their own real `Stripe` client from `c.env.STRIPE_SECRET_KEY`
 *    (vitest.config.ts's fake sentinel), so a code path that would
 *    actually REACH Stripe's network (e.g. a successful checkout session
 *    creation, or the webhook's `subscriptions.retrieve` re-fetch) is
 *    deliberately not exercised at this layer.
 * 2. Direct `processStripeEvent` calls (tier 2, below) — bypasses the HTTP
 *    layer entirely, calling `@bidmorrow/billing`'s `processStripeEvent`
 *    with a real local-D1 `db` and a FAKE, hand-written `stripe` object
 *    (satisfies `WebhookStripeClient`, no real `Stripe` instance, no
 *    network). This is where idempotent-duplicate, out-of-order
 *    (state-always-from-re-fetch), unknown-type-ack, failure-then-retry,
 *    and the cross-org `TenantMismatchError` guard are proven — exactly
 *    the "webhook processor with FAKE stripe client (injected)" tier the
 *    phase plan calls for.
 */
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
  createStripeClient,
  isFoundingPlanAvailable,
  processStripeEvent,
  type WebhookStripeClient,
} from '@bidmorrow/billing';
import {
  addOrganizationMember,
  createDb,
  getBillingEventByStripeId,
  getSubscription,
  insertAuditEvent,
  setFeatureFlag,
  upsertSubscriptionByStripeCustomerId,
  type Db,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';

import './index';

const BASE = 'https://bidmorrow.local';
const STATE_CHANGING_HEADERS = { origin: 'http://localhost:8787' };
const PASSWORD = 'correct horse battery staple 1!';

// Test-mode sentinels only — mirrors vitest.config.ts's fake bindings.
// Never a real Stripe key/secret (HUMAN_DECISION_BLOCKERS.md item 4).
const TEST_WEBHOOK_SECRET = 'whsec_fake_for_worker_tests_only';
const TEST_FOUNDING_PRICE = 'price_fake_founding_test';
const TEST_STANDARD_PRICE = 'price_fake_standard_test';

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
    status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
    plan: 'founding' | 'standard';
    currentPeriodEndAt: number | null;
  }> = {},
) {
  seedSeq += 1;
  return upsertSubscriptionByStripeCustomerId(db, toOrganizationId(orgId), {
    stripeCustomerId: `cus_test_${String(seedSeq)}`,
    stripeSubscriptionId: `sub_test_${String(seedSeq)}`,
    status: overrides.status ?? 'active',
    plan: overrides.plan ?? 'standard',
    currentPeriodEndAt: overrides.currentPeriodEndAt ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
    cancelAtPeriodEnd: false,
  });
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

  it('reflects a seeded active subscription', async () => {
    const { cookie, orgId } = await setUpOrg('StatusActive');
    const db = createDb(env.DB);
    await seedSubscription(db, orgId, { status: 'active', plan: 'founding' });

    const response = await fetchApi('/api/billing/status', { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      entitlement: { active: true, plan: 'founding', status: 'active', reason: 'active' },
      subscription: { plan: 'founding', status: 'active', cancelAtPeriodEnd: false },
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

    // Matches the pure unit-level assertion (checkout.test.ts) end-to-end
    // through the real DB-backed isFoundingPlanAvailable.
    expect(await isFoundingPlanAvailable(db)).toBe(false);
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

  it('409s when the org already has a non-canceled subscription', async () => {
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

  it('409s founding_unavailable (flag_closed) before any Stripe call', async () => {
    const { cookie } = await setUpOrg('CheckoutFoundingClosed');
    const db = createDb(env.DB);
    // Global flags are shared across this file's tests (one D1 per file,
    // same pattern documented elsewhere in this suite) — explicitly close
    // the flag rather than relying on its absent-by-default state, since an
    // earlier test may have already opened it.
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

  it('409s founding_unavailable (cap_reached) before any Stripe call', async () => {
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

  it('404s (no_billing_customer) before any Stripe call when the org has never checked out', async () => {
    const { cookie } = await setUpOrg('PortalNoCustomer');
    const response = await fetchApi('/api/billing/portal', {
      method: 'POST',
      headers: jsonHeaders(cookie),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'no_billing_customer' });
  });
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
  const stripe = createStripeClient('sk_test_fake_for_worker_tests_only');
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  return fetchApi('/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
}

function unhandledEventPayload(id: string): string {
  // A real Stripe event shape, but a type deliberately OUTSIDE the
  // recommended/handled set (`isHandledEvent`) — proves the endpoint
  // records + ack's it without ever needing a `subscriptions.retrieve`
  // network call (which this test tier cannot make — see file header).
  return JSON.stringify({
    id,
    object: 'event',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_test', object: 'payment_intent' } },
  });
}

describe('POST /api/webhooks/stripe', () => {
  it('400s with no row when the signature header is missing', async () => {
    const payload = unhandledEventPayload('evt_missing_sig');
    const response = await fetchApi('/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    expect(response.status).toBe(400);
    const db = createDb(env.DB);
    expect(await getBillingEventByStripeId(db, 'evt_missing_sig')).toBeNull();
  });

  it('400s with no row when the signature is invalid', async () => {
    const payload = unhandledEventPayload('evt_bad_sig');
    const response = await signedWebhookRequest(payload, 'whsec_totally_wrong_secret');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_signature' });
    const db = createDb(env.DB);
    expect(await getBillingEventByStripeId(db, 'evt_bad_sig')).toBeNull();
  });

  it('a valid signature processes an unhandled-type event: 200 + exactly one ignored row', async () => {
    const payload = unhandledEventPayload('evt_valid_unhandled');
    const response = await signedWebhookRequest(payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    const db = createDb(env.DB);
    const row = await getBillingEventByStripeId(db, 'evt_valid_unhandled');
    expect(row?.status).toBe('ignored');
    expect(row?.type).toBe('payment_intent.succeeded');
  });

  it('replaying the same event id is idempotent: 200 + single row, no duplicate insert', async () => {
    const payload = unhandledEventPayload('evt_replay');
    const first = await signedWebhookRequest(payload);
    expect(first.status).toBe(200);
    const second = await signedWebhookRequest(payload);
    expect(second.status).toBe(200);

    const count = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM billing_events WHERE stripe_event_id = ?',
    )
      .bind('evt_replay')
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tier 2: direct `processStripeEvent` calls with a FAKE injected Stripe
// client (real local D1, zero network) — idempotency, out-of-order
// (re-fetch, never payload), unknown type, failure-then-retry, tenant
// guard.
// ---------------------------------------------------------------------------

interface FakeSubscription {
  id: string;
  customer: string;
  status: Stripe.Subscription.Status;
  cancel_at_period_end: boolean;
  items: { data: [{ price: { id: string }; current_period_end: number }] };
}

function fakeSubscription(
  overrides: Partial<FakeSubscription> & { id: string; customer: string },
): Stripe.Subscription {
  return {
    id: overrides.id,
    customer: overrides.customer,
    status: overrides.status ?? 'active',
    cancel_at_period_end: overrides.cancel_at_period_end ?? false,
    items: overrides.items ?? {
      data: [
        {
          price: { id: TEST_STANDARD_PRICE },
          current_period_end: Math.floor(Date.now() / 1000) + 2_592_000,
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

/**
 * A fake `WebhookStripeClient` whose `retrieve` is scriptable per-call, so
 * tests can prove re-fetch (never payload) drives the stored state.
 * `cancel` calls are recorded (never actually reach Stripe — this tier is
 * zero-network) so SEC-P9-03 reconciliation tests can assert exactly which
 * subscription id got canceled without a real Stripe key.
 */
function makeFakeStripeClient(
  retrieveImpl: (id: string) => Promise<Stripe.Subscription>,
): WebhookStripeClient & {
  retrieveCallCount: number;
  cancelCalls: { id: string; params: Stripe.SubscriptionCancelParams }[];
} {
  const fake = {
    retrieveCallCount: 0,
    cancelCalls: [] as { id: string; params: Stripe.SubscriptionCancelParams }[],
    subscriptions: {
      async retrieve(id: string) {
        fake.retrieveCallCount += 1;
        return retrieveImpl(id);
      },
      async cancel(id: string, params: Stripe.SubscriptionCancelParams) {
        fake.cancelCalls.push({ id, params });
        return { id, status: 'canceled' } as unknown as Stripe.Subscription;
      },
    },
  };
  return fake;
}

function checkoutCompletedEvent(args: {
  id: string;
  organizationId: string;
  subscriptionId: string;
}): Stripe.Event {
  return {
    id: args.id,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        object: 'checkout.session',
        client_reference_id: args.organizationId,
        metadata: { organizationId: args.organizationId },
        subscription: args.subscriptionId,
      },
    },
  } as unknown as Stripe.Event;
}

function subscriptionUpdatedEvent(args: {
  id: string;
  organizationId: string;
  subscriptionId: string;
  /** Deliberately possibly-stale payload status — the processor must ignore this and re-fetch. */
  payloadStatus: string;
}): Stripe.Event {
  return {
    id: args.id,
    object: 'event',
    type: 'customer.subscription.updated',
    data: {
      object: {
        object: 'subscription',
        id: args.subscriptionId,
        status: args.payloadStatus,
        metadata: { organizationId: args.organizationId },
      },
    },
  } as unknown as Stripe.Event;
}

const PRICE_IDS = { founding: TEST_FOUNDING_PRICE, standard: TEST_STANDARD_PRICE };

describe('processStripeEvent (fake Stripe client, real D1)', () => {
  it('checkout.session.completed re-fetches and upserts, firing subscription_started once', async () => {
    const { orgId } = await setUpOrg('WebhookCheckout');
    const db = createDb(env.DB);
    const stripe = makeFakeStripeClient(async (id) =>
      fakeSubscription({ id, customer: 'cus_checkout_1', status: 'active' }),
    );
    const event = checkoutCompletedEvent({
      id: 'evt_checkout_completed_1',
      organizationId: orgId,
      subscriptionId: 'sub_checkout_1',
    });

    const outcome = await processStripeEvent({ db, stripe, priceIds: PRICE_IDS }, event);
    expect(outcome).toBe('processed');

    const subscription = await getSubscription(db, toOrganizationId(orgId));
    expect(subscription).toMatchObject({
      status: 'active',
      plan: 'standard',
      stripeCustomerId: 'cus_checkout_1',
    });

    const started = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM product_events WHERE organization_id = ? AND name = 'subscription_started'",
    )
      .bind(orgId)
      .first<{ n: number }>();
    expect(started?.n).toBe(1);
  });

  it('idempotent duplicate delivery: single processing, single retrieve call', async () => {
    const { orgId } = await setUpOrg('WebhookDuplicate');
    const db = createDb(env.DB);
    const stripe = makeFakeStripeClient(async (id) =>
      fakeSubscription({ id, customer: 'cus_dup_1', status: 'active' }),
    );
    const event = checkoutCompletedEvent({
      id: 'evt_duplicate_1',
      organizationId: orgId,
      subscriptionId: 'sub_dup_1',
    });

    const first = await processStripeEvent({ db, stripe, priceIds: PRICE_IDS }, event);
    const second = await processStripeEvent({ db, stripe, priceIds: PRICE_IDS }, event);
    expect(first).toBe('processed');
    expect(second).toBe('duplicate');
    expect(stripe.retrieveCallCount).toBe(1);

    const count = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM billing_events WHERE stripe_event_id = ?',
    )
      .bind('evt_duplicate_1')
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('out-of-order delivery: stored state always comes from the re-fetch, never the payload', async () => {
    const { orgId } = await setUpOrg('WebhookOutOfOrder');
    const db = createDb(env.DB);
    // Seed an existing active subscription (as if an earlier, "newer" event
    // already synced live state to active) via a first processed event.
    const seedStripe = makeFakeStripeClient(async (id) =>
      fakeSubscription({ id, customer: 'cus_ooo_1', status: 'active' }),
    );
    await processStripeEvent(
      { db, stripe: seedStripe, priceIds: PRICE_IDS },
      checkoutCompletedEvent({
        id: 'evt_ooo_newer',
        organizationId: orgId,
        subscriptionId: 'sub_ooo_1',
      }),
    );

    // An "older" event arrives AFTER, with a payload claiming `canceled` —
    // but the live re-fetch (what actually happens on Stripe's servers
    // right now) still reports `active`. The processor must trust the
    // re-fetch, not the payload's own status field.
    const staleStripe = makeFakeStripeClient(async (id) =>
      fakeSubscription({ id, customer: 'cus_ooo_1', status: 'active' }),
    );
    const outcome = await processStripeEvent(
      { db, stripe: staleStripe, priceIds: PRICE_IDS },
      subscriptionUpdatedEvent({
        id: 'evt_ooo_older',
        organizationId: orgId,
        subscriptionId: 'sub_ooo_1',
        payloadStatus: 'canceled',
      }),
    );
    expect(outcome).toBe('processed');

    const subscription = await getSubscription(db, toOrganizationId(orgId));
    // NOT canceled — the payload's claim was never trusted.
    expect(subscription?.status).toBe('active');
  });

  it('unknown event type: ack without ever calling Stripe', async () => {
    const { orgId } = await setUpOrg('WebhookUnknown');
    const db = createDb(env.DB);
    const stripe = makeFakeStripeClient(async () => {
      throw new Error('must never be called for an unhandled event type');
    });
    const event = {
      id: 'evt_unknown_type',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test' } },
    } as unknown as Stripe.Event;

    const outcome = await processStripeEvent({ db, stripe, priceIds: PRICE_IDS }, event);
    expect(outcome).toBe('ignored');
    expect(stripe.retrieveCallCount).toBe(0);

    const row = await getBillingEventByStripeId(db, 'evt_unknown_type');
    expect(row?.status).toBe('ignored');
    void orgId; // unused beyond documenting intent — org resolution never happens for this event type
  });

  it('failure-then-retry: a failed attempt is retried (not treated as a duplicate) and can succeed', async () => {
    const { orgId } = await setUpOrg('WebhookRetry');
    const db = createDb(env.DB);
    const event = checkoutCompletedEvent({
      id: 'evt_retry_1',
      organizationId: orgId,
      subscriptionId: 'sub_retry_1',
    });

    const failingStripe = makeFakeStripeClient(async () => {
      throw new Error('simulated transient Stripe API failure');
    });
    await expect(
      processStripeEvent({ db, stripe: failingStripe, priceIds: PRICE_IDS }, event),
    ).rejects.toThrow('simulated transient Stripe API failure');
    const failedRow = await getBillingEventByStripeId(db, 'evt_retry_1');
    expect(failedRow?.status).toBe('failed');

    const succeedingStripe = makeFakeStripeClient(async (id) =>
      fakeSubscription({ id, customer: 'cus_retry_1', status: 'active' }),
    );
    const outcome = await processStripeEvent(
      { db, stripe: succeedingStripe, priceIds: PRICE_IDS },
      event,
    );
    expect(outcome).toBe('processed');

    const finalRow = await getBillingEventByStripeId(db, 'evt_retry_1');
    expect(finalRow?.status).toBe('processed');
    const count = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM billing_events WHERE stripe_event_id = ?',
    )
      .bind('evt_retry_1')
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('tenant guard: an event resolving to org A never mutates a stripe_customer_id already owned by org B', async () => {
    const orgA = await setUpOrg('WebhookTenantA');
    const orgB = await setUpOrg('WebhookTenantB');
    const db = createDb(env.DB);
    // org B already owns this Stripe customer id.
    await seedSubscription(db, orgB.orgId, { status: 'active' });
    const existingB = await getSubscription(db, toOrganizationId(orgB.orgId));
    if (existingB === null) throw new Error('test setup: org B subscription missing');

    const stripe = makeFakeStripeClient(async (id) =>
      fakeSubscription({ id, customer: existingB.stripeCustomerId, status: 'active' }),
    );
    const event = checkoutCompletedEvent({
      id: 'evt_tenant_mismatch',
      organizationId: orgA.orgId,
      subscriptionId: 'sub_tenant_mismatch',
    });

    await expect(processStripeEvent({ db, stripe, priceIds: PRICE_IDS }, event)).rejects.toThrow();

    const row = await getBillingEventByStripeId(db, 'evt_tenant_mismatch');
    expect(row?.status).toBe('failed');
    // org A never gained a subscription; org B's row is untouched.
    expect(await getSubscription(db, toOrganizationId(orgA.orgId))).toBeNull();
    const untouchedB = await getSubscription(db, toOrganizationId(orgB.orgId));
    expect(untouchedB?.organizationId).toBe(orgB.orgId);
  });

  // -------------------------------------------------------------------------
  // SEC-P9-03: concurrent double-checkout reconciliation. A duplicate
  // Checkout completion mints a SECOND Stripe customer/subscription for an
  // organization that already has a non-canceled one on file
  // (`uq_subscriptions__organization_id` is 1:1, docs/data-model.md §9) —
  // the webhook for that second one must cancel it and reconcile, not
  // throw/wedge Stripe's retry loop.
  // -------------------------------------------------------------------------

  it('duplicate non-canceled customer: cancels the duplicate subscription, records the event, keeps the existing row untouched', async () => {
    const { orgId } = await setUpOrg('WebhookDupNonCanceled');
    const db = createDb(env.DB);
    const kept = await seedSubscription(db, orgId, { status: 'active' });

    const stripe = makeFakeStripeClient(async (id) =>
      fakeSubscription({ id, customer: 'cus_double_checkout', status: 'active' }),
    );
    const event = checkoutCompletedEvent({
      id: 'evt_double_checkout',
      organizationId: orgId,
      subscriptionId: 'sub_double_checkout',
    });

    const outcome = await processStripeEvent({ db, stripe, priceIds: PRICE_IDS }, event);
    expect(outcome).toBe('duplicate_reconciled');

    // The duplicate subscription — not the kept one — was canceled.
    expect(stripe.cancelCalls).toEqual([expect.objectContaining({ id: 'sub_double_checkout' })]);

    // The event is recorded as handled (not left `failed`/`received` to
    // wedge Stripe's retry loop).
    const row = await getBillingEventByStripeId(db, 'evt_double_checkout');
    expect(row?.status).toBe('processed');

    // The org's one-and-only row is exactly what it was before — the
    // duplicate never got written.
    const after = await getSubscription(db, toOrganizationId(orgId));
    expect(after).toMatchObject({
      stripeCustomerId: kept.stripeCustomerId,
      stripeSubscriptionId: kept.stripeSubscriptionId,
      status: 'active',
    });
  });

  it('same-customer re-delivery (a different event id for the SAME Stripe customer) still updates the existing row normally, no reconciliation', async () => {
    const { orgId } = await setUpOrg('WebhookSameCustomer');
    const db = createDb(env.DB);
    const seeded = await seedSubscription(db, orgId, { status: 'active' });

    const stripe = makeFakeStripeClient(async (id) =>
      fakeSubscription({ id, customer: seeded.stripeCustomerId, status: 'past_due' }),
    );
    const event = subscriptionUpdatedEvent({
      id: 'evt_same_customer_update',
      organizationId: orgId,
      subscriptionId: seeded.stripeSubscriptionId ?? 'sub_missing',
      payloadStatus: 'past_due',
    });

    const outcome = await processStripeEvent({ db, stripe, priceIds: PRICE_IDS }, event);
    expect(outcome).toBe('processed');
    expect(stripe.cancelCalls).toEqual([]);

    const after = await getSubscription(db, toOrganizationId(orgId));
    expect(after).toMatchObject({
      stripeCustomerId: seeded.stripeCustomerId,
      status: 'past_due',
    });
  });

  it('canceled-row reactivation is unchanged: a new subscription on the SAME (reused) customer updates the row, no reconciliation', async () => {
    const { orgId } = await setUpOrg('WebhookReactivate');
    const db = createDb(env.DB);
    const canceled = await seedSubscription(db, orgId, { status: 'canceled' });

    // Mirrors checkout.ts's real reactivation flow: a canceled row's
    // `stripe_customer_id` is always passed back as Checkout's `customer`
    // param, so the reactivating subscription is a NEW subscription id on
    // the SAME (reused) customer — never a brand-new customer.
    const stripe = makeFakeStripeClient(async (id) =>
      fakeSubscription({ id, customer: canceled.stripeCustomerId, status: 'active' }),
    );
    const event = checkoutCompletedEvent({
      id: 'evt_reactivate',
      organizationId: orgId,
      subscriptionId: 'sub_reactivated',
    });

    const outcome = await processStripeEvent({ db, stripe, priceIds: PRICE_IDS }, event);
    expect(outcome).toBe('processed');
    expect(stripe.cancelCalls).toEqual([]);

    const after = await getSubscription(db, toOrganizationId(orgId));
    expect(after).toMatchObject({
      stripeCustomerId: canceled.stripeCustomerId,
      stripeSubscriptionId: 'sub_reactivated',
      status: 'active',
    });
  });
});

// Referenced only to keep the audit-events import used honestly (checkout/
// portal route tests above assert status codes, not audit rows directly —
// this smoke-checks the writer function itself stays callable/typed).
void insertAuditEvent;

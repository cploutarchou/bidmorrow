/**
 * Unit tests for `checkout.ts`'s pure flag-parsing helpers, and for
 * `createCheckoutSession`'s Stripe Checkout Session params against a stubbed
 * `CheckoutStripeClient` (no network) with `@bidmorrow/db` mocked (no D1) —
 * same split as `cancellation.test.ts`: "packages/billing runs logic-only
 * tests, D1-coupled paths are tested at apps/worker level"
 * (`apps/worker/src/billing.d1.test.ts`), except the params passed to
 * `stripe.checkout.sessions.create` are exactly the orchestration this file
 * owns, so they're asserted here directly rather than through the HTTP
 * route (which never reaches Stripe's network at that test tier — see that
 * file's header).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationId } from '@bidmorrow/domain';
import type { Subscription } from '@bidmorrow/db';

const getFeatureFlag = vi.fn();
const getSubscription = vi.fn();
const countNonCanceledSubscriptionsByPlan = vi.fn();

vi.mock('@bidmorrow/db', () => ({
  getFeatureFlag: (...args: unknown[]) => getFeatureFlag(...args),
  getSubscription: (...args: unknown[]) => getSubscription(...args),
  countNonCanceledSubscriptionsByPlan: (...args: unknown[]) =>
    countNonCanceledSubscriptionsByPlan(...args),
}));

const {
  blocksNewCheckout,
  createCheckoutSession,
  isFoundingPlanOpenFlag,
  isStripeTaxEnabledFlag,
  resolveFoundingCap,
} = await import('./checkout');
const { DEFAULT_FOUNDING_CAP } = await import('./plans');

describe('blocksNewCheckout (existing-subscription 409 guard)', () => {
  it('blocks new checkout for every non-canceled status', () => {
    for (const status of ['trialing', 'active', 'past_due', 'unpaid']) {
      expect(blocksNewCheckout(status)).toBe(true);
    }
  });

  it('allows a new checkout (reactivation path) when canceled', () => {
    expect(blocksNewCheckout('canceled')).toBe(false);
  });
});

describe('isFoundingPlanOpenFlag', () => {
  it('is closed when the flag row is absent', () => {
    expect(isFoundingPlanOpenFlag(null)).toBe(false);
  });

  it('is closed when the flag value is explicitly false', () => {
    expect(isFoundingPlanOpenFlag({ valueJson: 'false' })).toBe(false);
  });

  it('is open only when the flag value is exactly boolean true', () => {
    expect(isFoundingPlanOpenFlag({ valueJson: 'true' })).toBe(true);
  });

  it('never treats a truthy-but-non-boolean value as open', () => {
    expect(isFoundingPlanOpenFlag({ valueJson: '"true"' })).toBe(false);
    expect(isFoundingPlanOpenFlag({ valueJson: '1' })).toBe(false);
  });
});

describe('resolveFoundingCap', () => {
  it('falls back to the default when the flag row is absent', () => {
    expect(resolveFoundingCap(null)).toBe(DEFAULT_FOUNDING_CAP);
  });

  it('reads a configured integer cap', () => {
    expect(resolveFoundingCap({ valueJson: '5' })).toBe(5);
  });

  it('falls back to the default on a malformed/negative value rather than throwing', () => {
    expect(resolveFoundingCap({ valueJson: '-3' })).toBe(DEFAULT_FOUNDING_CAP);
    expect(resolveFoundingCap({ valueJson: '"not-a-number"' })).toBe(DEFAULT_FOUNDING_CAP);
  });

  it('allows a zero cap (founding fully closed without touching the open flag)', () => {
    expect(resolveFoundingCap({ valueJson: '0' })).toBe(0);
  });
});

describe('isStripeTaxEnabledFlag', () => {
  it('is off when the flag row is absent', () => {
    expect(isStripeTaxEnabledFlag(null)).toBe(false);
  });

  it('is off when the flag value is explicitly false', () => {
    expect(isStripeTaxEnabledFlag({ valueJson: 'false' })).toBe(false);
  });

  it('is on only when the flag value is exactly boolean true', () => {
    expect(isStripeTaxEnabledFlag({ valueJson: 'true' })).toBe(true);
  });

  it('never treats a truthy-but-non-boolean value as on', () => {
    expect(isStripeTaxEnabledFlag({ valueJson: '"true"' })).toBe(false);
    expect(isStripeTaxEnabledFlag({ valueJson: '1' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createCheckoutSession: Stripe Tax params (FLAG_STRIPE_TAX), stubbed
// stripe.checkout.sessions.create (no network), @bidmorrow/db mocked above.
// ---------------------------------------------------------------------------

const ORG_ID = 'org_test_01J0CHECKOUT' as OrganizationId;
const FAKE_DB = {} as never;
const PRICE_IDS = { founding: 'price_founding_test', standard: 'price_standard_test' };
const APP_BASE_URL = 'https://app.bidmorrow.test';

function subscriptionRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_row_1',
    organizationId: ORG_ID,
    stripeCustomerId: 'cus_existing',
    stripeSubscriptionId: 'sub_existing',
    status: 'canceled',
    plan: 'standard',
    currentPeriodEndAt: 1_700_000_000_000,
    cancelAtPeriodEnd: 0,
    createdAt: 1_600_000_000_000,
    updatedAt: 1_600_000_000_000,
    ...overrides,
  } as Subscription;
}

function makeStripeStub() {
  const create = vi
    .fn()
    .mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/test' });
  return { checkout: { sessions: { create } }, billingPortal: { sessions: { create: vi.fn() } } };
}

/** Every flag lookup resolves `null` (absent) except the ones a test opts into via `overrides`. */
function stubFeatureFlags(overrides: Record<string, { valueJson: string } | null> = {}) {
  getFeatureFlag.mockImplementation((_db: unknown, key: string) =>
    Promise.resolve(key in overrides ? overrides[key] : null),
  );
}

describe('createCheckoutSession — Stripe Tax params (FLAG_STRIPE_TAX)', () => {
  beforeEach(() => {
    getFeatureFlag.mockReset();
    getSubscription.mockReset();
    countNonCanceledSubscriptionsByPlan.mockReset();
  });

  it('flag off (row absent): params are byte-identical to pre-Stripe-Tax — no automatic_tax/tax_id_collection/customer_update key at all', async () => {
    getSubscription.mockResolvedValue(null);
    stubFeatureFlags();
    const stripe = makeStripeStub();

    await createCheckoutSession(
      { db: FAKE_DB, stripe, priceIds: PRICE_IDS, appBaseUrl: APP_BASE_URL },
      { organizationId: ORG_ID, plan: 'standard' },
    );

    const params = stripe.checkout.sessions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect('automatic_tax' in params).toBe(false);
    expect('tax_id_collection' in params).toBe(false);
    expect('customer_update' in params).toBe(false);
    expect(params).toEqual({
      mode: 'subscription',
      client_reference_id: ORG_ID,
      line_items: [{ price: PRICE_IDS.standard, quantity: 1 }],
      metadata: { organizationId: ORG_ID, plan: 'standard' },
      subscription_data: { metadata: { organizationId: ORG_ID, plan: 'standard' } },
      success_url: `${APP_BASE_URL}/app/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/app/settings?checkout=cancelled`,
    });
  });

  it('flag off (explicit false): still no tax params', async () => {
    getSubscription.mockResolvedValue(null);
    stubFeatureFlags({ stripe_tax_enabled: { valueJson: 'false' } });
    const stripe = makeStripeStub();

    await createCheckoutSession(
      { db: FAKE_DB, stripe, priceIds: PRICE_IDS, appBaseUrl: APP_BASE_URL },
      { organizationId: ORG_ID, plan: 'standard' },
    );

    const params = stripe.checkout.sessions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect('automatic_tax' in params).toBe(false);
  });

  it('a malformed (truthy-but-non-boolean) flag value is treated as off, same as isStripeTaxEnabledFlag', async () => {
    getSubscription.mockResolvedValue(null);
    stubFeatureFlags({ stripe_tax_enabled: { valueJson: '"true"' } });
    const stripe = makeStripeStub();

    await createCheckoutSession(
      { db: FAKE_DB, stripe, priceIds: PRICE_IDS, appBaseUrl: APP_BASE_URL },
      { organizationId: ORG_ID, plan: 'standard' },
    );

    const params = stripe.checkout.sessions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect('automatic_tax' in params).toBe(false);
    expect('tax_id_collection' in params).toBe(false);
  });

  it('flag on, brand-new customer (no existing subscription row): adds automatic_tax + tax_id_collection, no customer_update and no customer param', async () => {
    getSubscription.mockResolvedValue(null);
    stubFeatureFlags({ stripe_tax_enabled: { valueJson: 'true' } });
    const stripe = makeStripeStub();

    await createCheckoutSession(
      { db: FAKE_DB, stripe, priceIds: PRICE_IDS, appBaseUrl: APP_BASE_URL },
      { organizationId: ORG_ID, plan: 'standard' },
    );

    const params = stripe.checkout.sessions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.tax_id_collection).toEqual({ enabled: true });
    expect('customer_update' in params).toBe(false);
    expect('customer' in params).toBe(false);
  });

  it('flag on, reactivating an existing (canceled) customer: adds customer_update address/name auto alongside automatic_tax + tax_id_collection', async () => {
    const canceled = subscriptionRow({ status: 'canceled', stripeCustomerId: 'cus_reactivate' });
    getSubscription.mockResolvedValue(canceled);
    stubFeatureFlags({ stripe_tax_enabled: { valueJson: 'true' } });
    const stripe = makeStripeStub();

    await createCheckoutSession(
      { db: FAKE_DB, stripe, priceIds: PRICE_IDS, appBaseUrl: APP_BASE_URL },
      { organizationId: ORG_ID, plan: 'standard' },
    );

    const params = stripe.checkout.sessions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.customer).toBe('cus_reactivate');
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.tax_id_collection).toEqual({ enabled: true });
    expect(params.customer_update).toEqual({ address: 'auto', name: 'auto' });
  });
});

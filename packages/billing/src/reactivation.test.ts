/**
 * Unit tests for `reactivateSubscription` (`POST /api/billing/reactivate`)
 * against a stubbed Stripe client (no network) and a mocked `@bidmorrow/db`
 * repository layer (no D1) — same "packages/billing runs logic-only tests"
 * split as cancellation.test.ts, since this module reuses
 * `applySubscriptionCancelAtPeriodEnd` from cancellation.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Subscription } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';

const getSubscription = vi.fn();
const upsertSubscriptionByStripeCustomerId = vi.fn();

vi.mock('@bidmorrow/db', () => ({
  getSubscription: (...args: unknown[]) => getSubscription(...args),
  upsertSubscriptionByStripeCustomerId: (...args: unknown[]) =>
    upsertSubscriptionByStripeCustomerId(...args),
}));

const { reactivateSubscription } = await import('./reactivation');

const ORG_ID = 'org_test_01J0REACT' as OrganizationId;
const FAKE_DB = {} as never;

function subscriptionRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_row_1',
    organizationId: ORG_ID,
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: 'sub_test',
    status: 'active',
    plan: 'standard',
    currentPeriodEndAt: 1_700_000_000_000,
    cancelAtPeriodEnd: 1,
    createdAt: 1_600_000_000_000,
    updatedAt: 1_600_000_000_000,
    ...overrides,
  } as Subscription;
}

describe('reactivateSubscription', () => {
  beforeEach(() => {
    getSubscription.mockReset();
    upsertSubscriptionByStripeCustomerId.mockReset();
  });

  it('returns no_subscription when the org has no subscription row', async () => {
    getSubscription.mockResolvedValue(null);
    const stripe = { subscriptions: { update: vi.fn() } };

    const outcome = await reactivateSubscription(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toEqual({ kind: 'no_subscription' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns no_subscription when the row has no stripeSubscriptionId yet', async () => {
    getSubscription.mockResolvedValue(subscriptionRow({ stripeSubscriptionId: null }));
    const stripe = { subscriptions: { update: vi.fn() } };

    const outcome = await reactivateSubscription(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toEqual({ kind: 'no_subscription' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns already_canceled (route to checkout) without calling Stripe when fully canceled', async () => {
    getSubscription.mockResolvedValue(subscriptionRow({ status: 'canceled' }));
    const stripe = { subscriptions: { update: vi.fn() } };

    const outcome = await reactivateSubscription(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toEqual({ kind: 'already_canceled' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(upsertSubscriptionByStripeCustomerId).not.toHaveBeenCalled();
  });

  it('returns not_scheduled when cancelAtPeriodEnd is not set (nothing to reverse)', async () => {
    getSubscription.mockResolvedValue(subscriptionRow({ cancelAtPeriodEnd: 0 }));
    const stripe = { subscriptions: { update: vi.fn() } };

    const outcome = await reactivateSubscription(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toEqual({ kind: 'not_scheduled' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns not_scheduled for a past_due subscription even if cancelAtPeriodEnd is set', async () => {
    getSubscription.mockResolvedValue(
      subscriptionRow({ status: 'past_due', cancelAtPeriodEnd: 1 }),
    );
    const stripe = { subscriptions: { update: vi.fn() } };

    const outcome = await reactivateSubscription(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toEqual({ kind: 'not_scheduled' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('reverses cancel_at_period_end and mirrors the result into the local row', async () => {
    const row = subscriptionRow();
    getSubscription.mockResolvedValue(row);
    upsertSubscriptionByStripeCustomerId.mockResolvedValue(row);
    const stripe = {
      subscriptions: {
        update: vi.fn().mockResolvedValue({ id: 'sub_test', cancel_at_period_end: false }),
      },
    };

    const outcome = await reactivateSubscription(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toEqual({
      kind: 'reactivated',
      stripeSubscriptionId: 'sub_test',
      status: 'active',
      currentPeriodEndAt: 1_700_000_000_000,
    });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_test', {
      cancel_at_period_end: false,
    });
    expect(upsertSubscriptionByStripeCustomerId).toHaveBeenCalledTimes(1);
    const [, , upsertArgs] = upsertSubscriptionByStripeCustomerId.mock.calls[0] as [
      unknown,
      OrganizationId,
      { cancelAtPeriodEnd: boolean },
    ];
    expect(upsertArgs.cancelAtPeriodEnd).toBe(false);
  });

  it('also reactivates a trialing subscription', async () => {
    const row = subscriptionRow({ status: 'trialing' });
    getSubscription.mockResolvedValue(row);
    upsertSubscriptionByStripeCustomerId.mockResolvedValue(row);
    const stripe = {
      subscriptions: {
        update: vi.fn().mockResolvedValue({ id: 'sub_test', cancel_at_period_end: false }),
      },
    };

    const outcome = await reactivateSubscription(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toMatchObject({ kind: 'reactivated', status: 'trialing' });
  });

  it('propagates a Stripe API error to the caller rather than swallowing it', async () => {
    getSubscription.mockResolvedValue(subscriptionRow());
    const stripeError = new Error('stripe: rate limited');
    const stripe = { subscriptions: { update: vi.fn().mockRejectedValue(stripeError) } };

    await expect(
      reactivateSubscription({ db: FAKE_DB, stripe }, { organizationId: ORG_ID }),
    ).rejects.toThrow('stripe: rate limited');

    expect(upsertSubscriptionByStripeCustomerId).not.toHaveBeenCalled();
  });
});

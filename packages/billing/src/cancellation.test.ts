/**
 * P11-R-03: unit tests for `cancelSubscriptionForOrgDeletion` against a
 * stubbed Stripe client (no network) and a mocked `@bidmorrow/db` repository
 * layer (no D1 — pure orchestration logic, mirroring `webhook.test.ts`'s
 * "packages/billing runs logic-only tests, D1-coupled paths are tested at
 * apps/worker level" split, except here the function under test IS the
 * orchestration, so the repository calls themselves are mocked rather than
 * exercised against real D1).
 *
 * Contract under test (from cancellation.ts's own doc comment): this
 * function is "best-effort" from the CALLER's perspective — `routes/org.ts`
 * wraps the call in try/catch and never blocks the deletion on it — but the
 * function itself does NOT swallow a Stripe error; it lets it propagate so
 * the caller's catch block can record the failure in the audit row. That
 * contract is exactly what the "Stripe error path" test below asserts.
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

const { cancelSubscriptionForOrgDeletion } = await import('./cancellation');

const ORG_ID = 'org_test_01J0CANCEL' as OrganizationId;
const FAKE_DB = {} as never;

function activeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_row_1',
    organizationId: ORG_ID,
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: 'sub_test',
    status: 'active',
    plan: 'standard',
    currentPeriodEndAt: 1_700_000_000_000,
    cancelAtPeriodEnd: 0,
    createdAt: 1_600_000_000_000,
    updatedAt: 1_600_000_000_000,
    ...overrides,
  } as Subscription;
}

describe('cancelSubscriptionForOrgDeletion', () => {
  beforeEach(() => {
    getSubscription.mockReset();
    upsertSubscriptionByStripeCustomerId.mockReset();
  });

  it('returns no_subscription when the org has no subscription row', async () => {
    getSubscription.mockResolvedValue(null);
    const stripe = { subscriptions: { update: vi.fn() } };

    const outcome = await cancelSubscriptionForOrgDeletion(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toEqual({ kind: 'no_subscription' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns no_subscription when the row has no stripeSubscriptionId yet', async () => {
    getSubscription.mockResolvedValue(activeSubscription({ stripeSubscriptionId: null }));
    const stripe = { subscriptions: { update: vi.fn() } };

    const outcome = await cancelSubscriptionForOrgDeletion(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toEqual({ kind: 'no_subscription' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('short-circuits on an already-canceled subscription without calling Stripe', async () => {
    getSubscription.mockResolvedValue(activeSubscription({ status: 'canceled' }));
    const stripe = { subscriptions: { update: vi.fn() } };

    const outcome = await cancelSubscriptionForOrgDeletion(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toEqual({ kind: 'already_canceled' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(upsertSubscriptionByStripeCustomerId).not.toHaveBeenCalled();
  });

  it('calls Stripe cancel_at_period_end and mirrors the result into the local row', async () => {
    const row = activeSubscription();
    getSubscription.mockResolvedValue(row);
    upsertSubscriptionByStripeCustomerId.mockResolvedValue(row);
    const stripe = {
      subscriptions: {
        update: vi.fn().mockResolvedValue({ id: 'sub_test', cancel_at_period_end: true }),
      },
    };

    const outcome = await cancelSubscriptionForOrgDeletion(
      { db: FAKE_DB, stripe },
      { organizationId: ORG_ID },
    );

    expect(outcome).toEqual({ kind: 'canceled_at_period_end', stripeSubscriptionId: 'sub_test' });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_test', {
      cancel_at_period_end: true,
    });
    expect(upsertSubscriptionByStripeCustomerId).toHaveBeenCalledTimes(1);
    const [dbArg, orgIdArg, upsertArgs] = upsertSubscriptionByStripeCustomerId.mock.calls[0] as [
      unknown,
      OrganizationId,
      { stripeSubscriptionId: string; cancelAtPeriodEnd: boolean },
    ];
    expect(dbArg).toBe(FAKE_DB);
    expect(orgIdArg).toBe(ORG_ID);
    expect(upsertArgs.stripeSubscriptionId).toBe('sub_test');
    expect(upsertArgs.cancelAtPeriodEnd).toBe(true);
  });

  it('propagates a Stripe API error to the caller rather than swallowing it', async () => {
    getSubscription.mockResolvedValue(activeSubscription());
    const stripeError = new Error('stripe: rate limited');
    const stripe = { subscriptions: { update: vi.fn().mockRejectedValue(stripeError) } };

    await expect(
      cancelSubscriptionForOrgDeletion({ db: FAKE_DB, stripe }, { organizationId: ORG_ID }),
    ).rejects.toThrow('stripe: rate limited');

    // The failed attempt is never mirrored into the local row — only a
    // successful Stripe response is trusted as "live state" (cancellation.ts
    // doc comment).
    expect(upsertSubscriptionByStripeCustomerId).not.toHaveBeenCalled();
  });
});

/**
 * Unit tests for `checkout.ts`'s pure flag-parsing helpers, and for
 * `createCheckoutTransaction`'s Paddle transaction body against a stubbed
 * transactions client (no network) with `@bidmorrow/db` mocked (no D1) —
 * same split as `cancellation.test.ts`: "packages/billing runs logic-only
 * tests, D1-coupled paths are tested at apps/worker level"
 * (`apps/worker/src/billing.d1.test.ts`), except the body passed to
 * `POST /transactions` is exactly the orchestration this file owns, so it is
 * asserted here directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationId } from '@bidmorrow/domain';
import type { Subscription } from '@bidmorrow/db';

import type { CreateTransactionBody } from './paddle-client';

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
  createCheckoutTransaction,
  isFoundingPlanAvailable,
  isFoundingPlanOpenFlag,
  resolveFoundingCap,
} = await import('./checkout');
const { DEFAULT_FOUNDING_CAP } = await import('./plans');
const { FoundingPlanUnavailableError, SubscriptionAlreadyExistsError } = await import('./errors');

describe('blocksNewCheckout (existing-subscription 409 guard)', () => {
  it('blocks new checkout for every non-canceled status, including paused', () => {
    for (const status of ['trialing', 'active', 'past_due', 'paused']) {
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

  it('accepts a zero cap (closes the plan without turning the flag off)', () => {
    expect(resolveFoundingCap({ valueJson: '0' })).toBe(0);
  });

  it('falls back to the default on a malformed/negative value rather than throwing', () => {
    expect(resolveFoundingCap({ valueJson: '-3' })).toBe(DEFAULT_FOUNDING_CAP);
    expect(resolveFoundingCap({ valueJson: '"not-a-number"' })).toBe(DEFAULT_FOUNDING_CAP);
  });
});

const ORG_ID = 'org_test_01J0CHECKOUT' as OrganizationId;
const FAKE_DB = {} as never;
const PRICE_IDS = { founding: 'pri_founding_test', standard: 'pri_standard_test' };

function subscriptionRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_row_1',
    organizationId: ORG_ID,
    billingCustomerId: 'ctm_existing',
    billingSubscriptionId: 'sub_existing',
    status: 'canceled',
    plan: 'standard',
    currentPeriodEndAt: 1_700_000_000_000,
    cancelAtPeriodEnd: 0,
    createdAt: 1_600_000_000_000,
    updatedAt: 1_600_000_000_000,
    ...overrides,
  } as Subscription;
}

function fakeTransactions(id: string | null = 'txn_01test') {
  const create = vi.fn(async (_body: CreateTransactionBody) => ({ id }) as never);
  return { client: { transactions: { create } }, create };
}

function openFoundingFlags(): void {
  getFeatureFlag.mockImplementation(async (_db: unknown, key: string) => {
    if (key === 'founding_plan_open') return { valueJson: 'true' };
    return null;
  });
  countNonCanceledSubscriptionsByPlan.mockResolvedValue(0);
}

describe('isFoundingPlanAvailable', () => {
  beforeEach(() => {
    getFeatureFlag.mockReset();
    countNonCanceledSubscriptionsByPlan.mockReset();
  });

  it('is false when the flag is closed, without counting seats', async () => {
    getFeatureFlag.mockResolvedValue(null);
    expect(await isFoundingPlanAvailable(FAKE_DB)).toBe(false);
    expect(countNonCanceledSubscriptionsByPlan).not.toHaveBeenCalled();
  });

  it('is false once the seat cap is reached', async () => {
    openFoundingFlags();
    countNonCanceledSubscriptionsByPlan.mockResolvedValue(DEFAULT_FOUNDING_CAP);
    expect(await isFoundingPlanAvailable(FAKE_DB)).toBe(false);
  });

  it('is true while seats remain', async () => {
    openFoundingFlags();
    expect(await isFoundingPlanAvailable(FAKE_DB)).toBe(true);
  });
});

describe('createCheckoutTransaction', () => {
  beforeEach(() => {
    getFeatureFlag.mockReset();
    getSubscription.mockReset();
    countNonCanceledSubscriptionsByPlan.mockReset();
  });

  it('throws SubscriptionAlreadyExistsError before any Paddle call when a live row exists', async () => {
    getSubscription.mockResolvedValue(subscriptionRow({ status: 'active' }));
    const { client, create } = fakeTransactions();
    await expect(
      createCheckoutTransaction(
        { db: FAKE_DB, paddle: client, priceIds: PRICE_IDS },
        { organizationId: ORG_ID, plan: 'standard' },
      ),
    ).rejects.toBeInstanceOf(SubscriptionAlreadyExistsError);
    expect(create).not.toHaveBeenCalled();
  });

  it('throws FoundingPlanUnavailableError(flag_closed) before any Paddle call', async () => {
    getSubscription.mockResolvedValue(null);
    getFeatureFlag.mockResolvedValue(null);
    const { client, create } = fakeTransactions();
    await expect(
      createCheckoutTransaction(
        { db: FAKE_DB, paddle: client, priceIds: PRICE_IDS },
        { organizationId: ORG_ID, plan: 'founding' },
      ),
    ).rejects.toMatchObject({ name: 'FoundingPlanUnavailableError', reason: 'flag_closed' });
    expect(create).not.toHaveBeenCalled();
  });

  it('throws FoundingPlanUnavailableError(cap_reached) before any Paddle call', async () => {
    getSubscription.mockResolvedValue(null);
    openFoundingFlags();
    countNonCanceledSubscriptionsByPlan.mockResolvedValue(DEFAULT_FOUNDING_CAP);
    const { client, create } = fakeTransactions();
    const error = await createCheckoutTransaction(
      { db: FAKE_DB, paddle: client, priceIds: PRICE_IDS },
      { organizationId: ORG_ID, plan: 'founding' },
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(FoundingPlanUnavailableError);
    expect((error as InstanceType<typeof FoundingPlanUnavailableError>).reason).toBe('cap_reached');
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a transaction for a brand-new customer: env price id, org custom_data, EUR, no customer_id', async () => {
    getSubscription.mockResolvedValue(null);
    const { client, create } = fakeTransactions('txn_01new');
    const result = await createCheckoutTransaction(
      { db: FAKE_DB, paddle: client, priceIds: PRICE_IDS },
      { organizationId: ORG_ID, plan: 'standard' },
    );
    expect(result).toEqual({ transactionId: 'txn_01new' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      items: [{ price_id: 'pri_standard_test', quantity: 1 }],
      custom_data: { organization_id: ORG_ID, plan: 'standard' },
      currency_code: 'EUR',
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('customer_id');
    // No founding gate reads for the standard plan.
    expect(countNonCanceledSubscriptionsByPlan).not.toHaveBeenCalled();
  });

  it('uses the founding price id when the founding plan is open', async () => {
    getSubscription.mockResolvedValue(null);
    openFoundingFlags();
    const { client, create } = fakeTransactions();
    await createCheckoutTransaction(
      { db: FAKE_DB, paddle: client, priceIds: PRICE_IDS },
      { organizationId: ORG_ID, plan: 'founding' },
    );
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      items: [{ price_id: 'pri_founding_test', quantity: 1 }],
      custom_data: { organization_id: ORG_ID, plan: 'founding' },
    });
  });

  it('reuses the existing customer id on reactivation, read from the FRESHEST row', async () => {
    // First read: nothing. Second (re-check) read: a canceled row appeared.
    getSubscription
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(subscriptionRow({ status: 'canceled', billingCustomerId: 'ctm_x' }));
    const { client, create } = fakeTransactions();
    await createCheckoutTransaction(
      { db: FAKE_DB, paddle: client, priceIds: PRICE_IDS },
      { organizationId: ORG_ID, plan: 'standard' },
    );
    expect(create.mock.calls[0]?.[0]).toMatchObject({ customer_id: 'ctm_x' });
  });

  it('re-checks the row before the network call (SEC-P9-03) and 409s if one appeared', async () => {
    getSubscription
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(subscriptionRow({ status: 'active' }));
    const { client, create } = fakeTransactions();
    await expect(
      createCheckoutTransaction(
        { db: FAKE_DB, paddle: client, priceIds: PRICE_IDS },
        { organizationId: ORG_ID, plan: 'standard' },
      ),
    ).rejects.toBeInstanceOf(SubscriptionAlreadyExistsError);
    expect(getSubscription).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
  });

  it('throws loudly when Paddle returns a transaction with no id', async () => {
    getSubscription.mockResolvedValue(null);
    const { client } = fakeTransactions(null);
    await expect(
      createCheckoutTransaction(
        { db: FAKE_DB, paddle: client, priceIds: PRICE_IDS },
        { organizationId: ORG_ID, plan: 'standard' },
      ),
    ).rejects.toThrow(/no id/);
  });

  it('propagates a Paddle API error rather than swallowing it', async () => {
    getSubscription.mockResolvedValue(null);
    const create = vi.fn(async () => {
      throw new Error('paddle down');
    });
    await expect(
      createCheckoutTransaction(
        { db: FAKE_DB, paddle: { transactions: { create } }, priceIds: PRICE_IDS },
        { organizationId: ORG_ID, plan: 'standard' },
      ),
    ).rejects.toThrow('paddle down');
  });
});

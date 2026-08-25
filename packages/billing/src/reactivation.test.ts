/**
 * Unit tests for `reactivateSubscription` (`POST /api/billing/reactivate`)
 * against a stubbed Paddle subscriptions client (no network) and a mocked
 * `@bidmorrow/db` repository layer (no D1) — same split as
 * cancellation.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Subscription } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';

import type { PaddleSubscription } from './paddle-client';

const getSubscription = vi.fn();
const upsertSubscriptionByBillingCustomerId = vi.fn();

vi.mock('@bidmorrow/db', () => ({
  getSubscription: (...args: unknown[]) => getSubscription(...args),
  upsertSubscriptionByBillingCustomerId: (...args: unknown[]) =>
    upsertSubscriptionByBillingCustomerId(...args),
}));

const { reactivateSubscription } = await import('./reactivation');

const ORG_ID = 'org_test_01J0REACT' as OrganizationId;
const FAKE_DB = {} as never;
const PERIOD_END = '2026-09-15T00:00:00.000Z';

function scheduledSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_row_1',
    organizationId: ORG_ID,
    billingCustomerId: 'ctm_test',
    billingSubscriptionId: 'sub_test',
    status: 'active',
    plan: 'founding',
    currentPeriodEndAt: 1_700_000_000_000,
    cancelAtPeriodEnd: 1,
    createdAt: 1_600_000_000_000,
    updatedAt: 1_600_000_000_000,
    ...overrides,
  } as Subscription;
}

function liveSubscription(overrides: Partial<PaddleSubscription> = {}): PaddleSubscription {
  return {
    id: 'sub_test',
    status: 'active',
    customer_id: 'ctm_test',
    custom_data: { organization_id: ORG_ID },
    current_billing_period: { starts_at: '2026-08-15T00:00:00.000Z', ends_at: PERIOD_END },
    next_billed_at: PERIOD_END,
    scheduled_change: null,
    items: [{ price: { id: 'pri_founding_test' } }],
    ...overrides,
  };
}

function fakePaddle(updateResult: PaddleSubscription | Error = liveSubscription()) {
  const update = vi.fn(async () => {
    if (updateResult instanceof Error) throw updateResult;
    return updateResult;
  });
  const cancel = vi.fn();
  return { paddle: { subscriptions: { cancel, update } }, update, cancel };
}

describe('reactivateSubscription', () => {
  beforeEach(() => {
    getSubscription.mockReset();
    upsertSubscriptionByBillingCustomerId.mockReset();
  });

  it('returns no_subscription for a missing row or missing provider id, without calling Paddle', async () => {
    const { paddle, update } = fakePaddle();
    getSubscription.mockResolvedValueOnce(null);
    expect(
      await reactivateSubscription({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).toEqual({ kind: 'no_subscription' });
    getSubscription.mockResolvedValueOnce(scheduledSubscription({ billingSubscriptionId: null }));
    expect(
      await reactivateSubscription({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).toEqual({ kind: 'no_subscription' });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns already_canceled without calling Paddle', async () => {
    getSubscription.mockResolvedValue(scheduledSubscription({ status: 'canceled' }));
    const { paddle, update } = fakePaddle();
    expect(
      await reactivateSubscription({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).toEqual({ kind: 'already_canceled' });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns not_scheduled when nothing is pending', async () => {
    getSubscription.mockResolvedValue(scheduledSubscription({ cancelAtPeriodEnd: 0 }));
    const { paddle, update } = fakePaddle();
    expect(
      await reactivateSubscription({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).toEqual({ kind: 'not_scheduled' });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns not_scheduled for past_due/paused even with a pending cancel', async () => {
    const { paddle, update } = fakePaddle();
    for (const status of ['past_due', 'paused'] as const) {
      getSubscription.mockResolvedValueOnce(scheduledSubscription({ status }));
      expect(
        await reactivateSubscription({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
      ).toEqual({ kind: 'not_scheduled' });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('removes the scheduled change and mirrors the live response', async () => {
    getSubscription.mockResolvedValue(scheduledSubscription());
    const { paddle, update } = fakePaddle();
    const outcome = await reactivateSubscription(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID },
    );
    expect(outcome).toEqual({
      kind: 'reactivated',
      billingSubscriptionId: 'sub_test',
      status: 'active',
      currentPeriodEndAt: Date.parse(PERIOD_END),
    });
    expect(update).toHaveBeenCalledWith('sub_test', { scheduled_change: null });
    expect(upsertSubscriptionByBillingCustomerId).toHaveBeenCalledWith(FAKE_DB, ORG_ID, {
      billingCustomerId: 'ctm_test',
      billingSubscriptionId: 'sub_test',
      status: 'active',
      plan: 'founding',
      currentPeriodEndAt: Date.parse(PERIOD_END),
      cancelAtPeriodEnd: false,
    });
  });

  it('reactivates a trialing subscription too', async () => {
    getSubscription.mockResolvedValue(scheduledSubscription({ status: 'trialing' }));
    const { paddle } = fakePaddle(liveSubscription({ status: 'trialing' }));
    const outcome = await reactivateSubscription(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID },
    );
    expect(outcome).toMatchObject({ kind: 'reactivated', status: 'trialing' });
  });

  it('propagates a Paddle API error and writes nothing', async () => {
    getSubscription.mockResolvedValue(scheduledSubscription());
    const { paddle } = fakePaddle(new Error('paddle down'));
    await expect(
      reactivateSubscription({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).rejects.toThrow('paddle down');
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
  });
});

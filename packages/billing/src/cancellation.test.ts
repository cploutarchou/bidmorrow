/**
 * Unit tests for `cancelSubscriptionForOrgDeletion` and
 * `cancelSubscriptionAtPeriodEnd` against a stubbed Paddle subscriptions
 * client (no network) and a mocked `@bidmorrow/db` repository layer (no D1
 * — pure orchestration logic; DB-coupled paths are tested at the
 * apps/worker level).
 *
 * Contract under test: the org-deletion variant is "best-effort" from the
 * CALLER's perspective (`routes/org.ts` wraps it in try/catch) but the
 * function itself does NOT swallow a Paddle error — it propagates so the
 * caller can record the failure in the audit row.
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

const { cancelSubscriptionForOrgDeletion, cancelSubscriptionAtPeriodEnd, hasScheduledCancel } =
  await import('./cancellation');

const ORG_ID = 'org_test_01J0CANCEL' as OrganizationId;
const FAKE_DB = {} as never;
const PERIOD_END = '2026-09-15T00:00:00.000Z';

function activeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_row_1',
    organizationId: ORG_ID,
    billingCustomerId: 'ctm_test',
    billingSubscriptionId: 'sub_test',
    status: 'active',
    plan: 'standard',
    currentPeriodEndAt: 1_700_000_000_000,
    cancelAtPeriodEnd: 0,
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
    scheduled_change: { action: 'cancel', effective_at: PERIOD_END, resume_at: null },
    items: [{ price: { id: 'pri_standard_test' } }],
    ...overrides,
  };
}

function fakePaddle(cancelResult: PaddleSubscription | Error = liveSubscription()) {
  const cancel = vi.fn(async () => {
    if (cancelResult instanceof Error) throw cancelResult;
    return cancelResult;
  });
  const update = vi.fn();
  return { paddle: { subscriptions: { cancel, update } }, cancel, update };
}

describe('hasScheduledCancel', () => {
  it('is true only for a pending cancel', () => {
    expect(hasScheduledCancel(liveSubscription())).toBe(true);
    expect(hasScheduledCancel(liveSubscription({ scheduled_change: null }))).toBe(false);
    expect(
      hasScheduledCancel(
        liveSubscription({
          scheduled_change: { action: 'pause', effective_at: PERIOD_END, resume_at: null },
        }),
      ),
    ).toBe(false);
  });
});

describe('cancelSubscriptionForOrgDeletion', () => {
  beforeEach(() => {
    getSubscription.mockReset();
    upsertSubscriptionByBillingCustomerId.mockReset();
  });

  it('returns no_subscription when the org has no row, without calling Paddle', async () => {
    getSubscription.mockResolvedValue(null);
    const { paddle, cancel } = fakePaddle();
    const outcome = await cancelSubscriptionForOrgDeletion(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID },
    );
    expect(outcome).toEqual({ kind: 'no_subscription' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('returns no_subscription when the row has no provider subscription id yet', async () => {
    getSubscription.mockResolvedValue(activeSubscription({ billingSubscriptionId: null }));
    const { paddle, cancel } = fakePaddle();
    const outcome = await cancelSubscriptionForOrgDeletion(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID },
    );
    expect(outcome).toEqual({ kind: 'no_subscription' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('returns already_canceled without calling Paddle', async () => {
    getSubscription.mockResolvedValue(activeSubscription({ status: 'canceled' }));
    const { paddle, cancel } = fakePaddle();
    const outcome = await cancelSubscriptionForOrgDeletion(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID },
    );
    expect(outcome).toEqual({ kind: 'already_canceled' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('schedules a cancel at next_billing_period and mirrors the live response into the row', async () => {
    getSubscription.mockResolvedValue(activeSubscription());
    const { paddle, cancel } = fakePaddle();
    const outcome = await cancelSubscriptionForOrgDeletion(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID },
    );
    expect(outcome).toEqual({ kind: 'canceled_at_period_end', billingSubscriptionId: 'sub_test' });
    expect(cancel).toHaveBeenCalledWith('sub_test', { effective_from: 'next_billing_period' });
    expect(upsertSubscriptionByBillingCustomerId).toHaveBeenCalledWith(FAKE_DB, ORG_ID, {
      billingCustomerId: 'ctm_test',
      billingSubscriptionId: 'sub_test',
      status: 'active',
      plan: 'standard',
      currentPeriodEndAt: Date.parse(PERIOD_END),
      cancelAtPeriodEnd: true,
    });
  });

  it('keeps the local period end when the live entity has no billing period', async () => {
    getSubscription.mockResolvedValue(activeSubscription({ currentPeriodEndAt: 123 }));
    const { paddle } = fakePaddle(liveSubscription({ current_billing_period: null }));
    await cancelSubscriptionForOrgDeletion({ db: FAKE_DB, paddle }, { organizationId: ORG_ID });
    expect(upsertSubscriptionByBillingCustomerId.mock.calls[0]?.[2]).toMatchObject({
      currentPeriodEndAt: 123,
    });
  });

  it('propagates a Paddle API error instead of swallowing it, writing nothing', async () => {
    getSubscription.mockResolvedValue(activeSubscription());
    const { paddle } = fakePaddle(new Error('paddle unreachable'));
    await expect(
      cancelSubscriptionForOrgDeletion({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).rejects.toThrow('paddle unreachable');
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
  });
});

describe('cancelSubscriptionAtPeriodEnd (user-initiated)', () => {
  beforeEach(() => {
    getSubscription.mockReset();
    upsertSubscriptionByBillingCustomerId.mockReset();
  });

  it('returns no_subscription for a missing row or missing provider id', async () => {
    const { paddle, cancel } = fakePaddle();
    getSubscription.mockResolvedValueOnce(null);
    expect(
      await cancelSubscriptionAtPeriodEnd({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).toEqual({ kind: 'no_subscription' });
    getSubscription.mockResolvedValueOnce(activeSubscription({ billingSubscriptionId: null }));
    expect(
      await cancelSubscriptionAtPeriodEnd({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).toEqual({ kind: 'no_subscription' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('returns already_canceled without calling Paddle', async () => {
    getSubscription.mockResolvedValue(activeSubscription({ status: 'canceled' }));
    const { paddle, cancel } = fakePaddle();
    expect(
      await cancelSubscriptionAtPeriodEnd({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).toEqual({ kind: 'already_canceled' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('is idempotent: already_scheduled makes no Paddle call and no write', async () => {
    getSubscription.mockResolvedValue(
      activeSubscription({ cancelAtPeriodEnd: 1, currentPeriodEndAt: 42 }),
    );
    const { paddle, cancel } = fakePaddle();
    expect(
      await cancelSubscriptionAtPeriodEnd({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).toEqual({ kind: 'already_scheduled', currentPeriodEndAt: 42 });
    expect(cancel).not.toHaveBeenCalled();
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
  });

  it('schedules the cancel and returns the live period end', async () => {
    getSubscription.mockResolvedValue(activeSubscription());
    const { paddle, cancel } = fakePaddle();
    const outcome = await cancelSubscriptionAtPeriodEnd(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID },
    );
    expect(outcome).toEqual({
      kind: 'canceled_at_period_end',
      billingSubscriptionId: 'sub_test',
      currentPeriodEndAt: Date.parse(PERIOD_END),
    });
    expect(cancel).toHaveBeenCalledWith('sub_test', { effective_from: 'next_billing_period' });
    expect(upsertSubscriptionByBillingCustomerId.mock.calls[0]?.[2]).toMatchObject({
      cancelAtPeriodEnd: true,
    });
  });

  it('also works for a trialing subscription', async () => {
    getSubscription.mockResolvedValue(activeSubscription({ status: 'trialing' }));
    const { paddle } = fakePaddle(liveSubscription({ status: 'trialing' }));
    const outcome = await cancelSubscriptionAtPeriodEnd(
      { db: FAKE_DB, paddle },
      { organizationId: ORG_ID },
    );
    expect(outcome.kind).toBe('canceled_at_period_end');
    expect(upsertSubscriptionByBillingCustomerId.mock.calls[0]?.[2]).toMatchObject({
      status: 'trialing',
      cancelAtPeriodEnd: true,
    });
  });

  it('propagates a Paddle API error', async () => {
    getSubscription.mockResolvedValue(activeSubscription());
    const { paddle } = fakePaddle(new Error('boom'));
    await expect(
      cancelSubscriptionAtPeriodEnd({ db: FAKE_DB, paddle }, { organizationId: ORG_ID }),
    ).rejects.toThrow('boom');
  });
});

/**
 * Pure-logic tests (handled-event check, organization resolution) plus
 * `processPaddleEvent`'s orchestration against a stubbed Paddle
 * subscriptions client (no network) and a mocked `@bidmorrow/db`
 * repository layer (no D1). The same idempotency/re-fetch/tenant-guard
 * paths are additionally D1-integration-tested at the apps/worker level
 * (apps/worker/src/billing.d1.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Subscription } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';

import type { PaddleSubscription } from './paddle-client';
import type { PaddleEvent } from './webhook-signature';

const getBillingEventByProviderId = vi.fn();
const getSubscription = vi.fn();
const insertBillingEventIfNew = vi.fn();
const insertProductEvent = vi.fn();
const markBillingEventStatus = vi.fn();
const upsertSubscriptionByBillingCustomerId = vi.fn();

vi.mock('@bidmorrow/db', () => ({
  getBillingEventByProviderId: (...args: unknown[]) => getBillingEventByProviderId(...args),
  getSubscription: (...args: unknown[]) => getSubscription(...args),
  insertBillingEventIfNew: (...args: unknown[]) => insertBillingEventIfNew(...args),
  insertProductEvent: (...args: unknown[]) => insertProductEvent(...args),
  markBillingEventStatus: (...args: unknown[]) => markBillingEventStatus(...args),
  upsertSubscriptionByBillingCustomerId: (...args: unknown[]) =>
    upsertSubscriptionByBillingCustomerId(...args),
}));

const { signOrganizationProvenance } = await import('./provenance');
const {
  SUBSCRIBED_WEBHOOK_EVENT_TYPES,
  isHandledEvent,
  organizationIdFromCustomData,
  processPaddleEvent,
  resolveOrganizationIdFromPayload,
  resolveSubscriptionId,
} = await import('./webhook');

const ORG_ID = 'org_test_01J0BILLING' as OrganizationId;
const FAKE_DB = {} as never;
const PRICE_IDS = { founding: 'pri_founding_test', standard: 'pri_standard_test' };
const PERIOD_END = '2026-09-15T00:00:00.000Z';
const SECRET = 'pdl_ntfset_test_secret';
/** custom_data exactly as checkout.ts writes it (provenance-signed). */
const SIGNED = {
  organization_id: ORG_ID,
  organization_sig: await signOrganizationProvenance(SECRET, ORG_ID),
  plan: 'standard',
};
const DEPS = {
  db: FAKE_DB,
  paddle: undefined as never,
  priceIds: PRICE_IDS,
  provenanceSecret: SECRET,
};

function event(overrides: Partial<PaddleEvent> & { data?: unknown } = {}): PaddleEvent {
  return {
    event_id: 'evt_01test',
    event_type: 'subscription.updated',
    occurred_at: '2026-08-25T10:00:00.000Z',
    data: { id: 'sub_test', custom_data: SIGNED },
    ...overrides,
  };
}

function liveSubscription(overrides: Partial<PaddleSubscription> = {}): PaddleSubscription {
  return {
    id: 'sub_test',
    status: 'active',
    customer_id: 'ctm_test',
    custom_data: SIGNED,
    current_billing_period: { starts_at: '2026-08-15T00:00:00.000Z', ends_at: PERIOD_END },
    next_billed_at: PERIOD_END,
    scheduled_change: null,
    items: [{ price: { id: 'pri_standard_test' } }],
    ...overrides,
  };
}

function row(overrides: Partial<Subscription> = {}): Subscription {
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

function fakePaddle(getResult: PaddleSubscription | Error = liveSubscription()) {
  const get = vi.fn(async () => {
    if (getResult instanceof Error) throw getResult;
    return getResult;
  });
  const cancel = vi.fn(async () => liveSubscription({ status: 'canceled' }));
  return { paddle: { subscriptions: { get, cancel } }, get, cancel };
}

describe('isHandledEvent', () => {
  it('accepts every subscribed subscription.* type with a well-formed data.id', () => {
    expect(SUBSCRIBED_WEBHOOK_EVENT_TYPES).toHaveLength(8);
    for (const type of SUBSCRIBED_WEBHOOK_EVENT_TYPES) {
      expect(isHandledEvent(event({ event_type: type }))).toBe(true);
    }
  });

  it('rejects unsubscribed/unknown types', () => {
    for (const type of [
      'transaction.completed',
      'customer.updated',
      'subscription.imported',
      'subscription',
      '',
    ]) {
      expect(isHandledEvent(event({ event_type: type }))).toBe(false);
    }
  });

  it('rejects a handled type whose data is not a subscription entity', () => {
    expect(isHandledEvent(event({ data: null }))).toBe(false);
    expect(isHandledEvent(event({ data: 'sub_test' }))).toBe(false);
    expect(isHandledEvent(event({ data: {} }))).toBe(false);
    expect(isHandledEvent(event({ data: { id: '' } }))).toBe(false);
    expect(isHandledEvent(event({ data: { id: 42 } }))).toBe(false);
  });
});

describe('organizationIdFromCustomData / resolveOrganizationIdFromPayload / resolveSubscriptionId', () => {
  it('reads a provenance-SIGNED custom_data.organization_id', async () => {
    expect(await organizationIdFromCustomData(SECRET, SIGNED)).toBe(ORG_ID);
    const e = event();
    if (!isHandledEvent(e)) throw new Error('fixture');
    expect(await resolveOrganizationIdFromPayload(SECRET, e)).toBe(ORG_ID);
    expect(resolveSubscriptionId(e)).toBe('sub_test');
  });

  it('refuses an UNSIGNED or mis-signed organization_id (SEC-PDL-01) — never throws', async () => {
    const sig = SIGNED.organization_sig;
    expect(await organizationIdFromCustomData(SECRET, { organization_id: ORG_ID })).toBeNull();
    expect(
      await organizationIdFromCustomData(SECRET, {
        organization_id: ORG_ID,
        organization_sig: 'x',
      }),
    ).toBeNull();
    // A valid signature for ORG_ID does not authorise a DIFFERENT org id.
    expect(
      await organizationIdFromCustomData(SECRET, {
        organization_id: 'org_victim',
        organization_sig: sig,
      }),
    ).toBeNull();
    // Signed with the wrong secret.
    expect(await organizationIdFromCustomData('other-secret', SIGNED)).toBeNull();
    const e = event({ data: { id: 'sub_test', custom_data: { organization_id: ORG_ID } } });
    if (!isHandledEvent(e)) throw new Error('fixture');
    expect(await resolveOrganizationIdFromPayload(SECRET, e)).toBeNull();
  });

  it('never throws on absent/blank/non-string custom data', async () => {
    expect(await organizationIdFromCustomData(SECRET, null)).toBeNull();
    expect(await organizationIdFromCustomData(SECRET, undefined)).toBeNull();
    expect(await organizationIdFromCustomData(SECRET, {})).toBeNull();
    expect(await organizationIdFromCustomData(SECRET, { organization_id: '   ' })).toBeNull();
    expect(await organizationIdFromCustomData(SECRET, { organization_id: 123 })).toBeNull();
    expect(await organizationIdFromCustomData(SECRET, { organizationId: ORG_ID })).toBeNull();
    const e = event({ data: { id: 'sub_test' } });
    if (!isHandledEvent(e)) throw new Error('fixture');
    expect(await resolveOrganizationIdFromPayload(SECRET, e)).toBeNull();
  });
});

describe('processPaddleEvent', () => {
  beforeEach(() => {
    for (const fn of [
      getBillingEventByProviderId,
      getSubscription,
      insertBillingEventIfNew,
      insertProductEvent,
      markBillingEventStatus,
      upsertSubscriptionByBillingCustomerId,
    ]) {
      fn.mockReset();
    }
    insertBillingEventIfNew.mockResolvedValue(true);
    getSubscription.mockResolvedValue(null);
  });

  it('records the event FIRST, re-fetches live state, upserts it and fires subscription_started', async () => {
    const { paddle, get } = fakePaddle(
      liveSubscription({
        scheduled_change: { action: 'cancel', effective_at: PERIOD_END, resume_at: null },
      }),
    );
    const outcome = await processPaddleEvent(
      { ...DEPS, paddle },
      event({
        data: { id: 'sub_test', status: 'canceled', custom_data: SIGNED },
      }),
    );
    expect(outcome).toBe('processed');
    expect(insertBillingEventIfNew).toHaveBeenCalledWith(FAKE_DB, {
      providerEventId: 'evt_01test',
      type: 'subscription.updated',
      organizationId: ORG_ID,
      payloadJson: expect.stringContaining('"event_id":"evt_01test"'),
    });
    expect(insertBillingEventIfNew.mock.invocationCallOrder[0]).toBeLessThan(
      get.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(get).toHaveBeenCalledWith('sub_test');
    // The payload said `canceled`; the LIVE state (active) is what gets written.
    expect(upsertSubscriptionByBillingCustomerId).toHaveBeenCalledWith(FAKE_DB, ORG_ID, {
      billingCustomerId: 'ctm_test',
      billingSubscriptionId: 'sub_test',
      status: 'active',
      plan: 'standard',
      currentPeriodEndAt: Date.parse(PERIOD_END),
      cancelAtPeriodEnd: true,
    });
    expect(insertProductEvent).toHaveBeenCalledWith(FAKE_DB, {
      organizationId: ORG_ID,
      userId: null,
      name: 'subscription_started',
    });
    expect(markBillingEventStatus).toHaveBeenCalledWith(FAKE_DB, 'evt_01test', 'processed');
  });

  it('fires subscription_canceled only on the active→canceled transition', async () => {
    getSubscription.mockResolvedValue(row({ status: 'active' }));
    const { paddle } = fakePaddle(liveSubscription({ status: 'canceled' }));
    await processPaddleEvent({ ...DEPS, paddle }, event({ event_type: 'subscription.canceled' }));
    expect(insertProductEvent).toHaveBeenCalledWith(FAKE_DB, {
      organizationId: ORG_ID,
      userId: null,
      name: 'subscription_canceled',
    });
    expect(upsertSubscriptionByBillingCustomerId.mock.calls[0]?.[2]).toMatchObject({
      status: 'canceled',
    });
  });

  it('fires no product event on an active→active redelivery', async () => {
    getSubscription.mockResolvedValue(row({ status: 'active' }));
    const { paddle } = fakePaddle();
    await processPaddleEvent({ ...DEPS, paddle }, event());
    expect(insertProductEvent).not.toHaveBeenCalled();
  });

  it('maps paused into the row and treats paused→active as a start', async () => {
    getSubscription.mockResolvedValue(row({ status: 'paused' }));
    const { paddle } = fakePaddle();
    await processPaddleEvent({ ...DEPS, paddle }, event({ event_type: 'subscription.resumed' }));
    expect(insertProductEvent).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ name: 'subscription_started' }),
    );
  });

  it('acks a true duplicate (processed/ignored) with zero side effects and no Paddle call', async () => {
    insertBillingEventIfNew.mockResolvedValue(false);
    const { paddle, get } = fakePaddle();
    for (const status of ['processed', 'ignored']) {
      getBillingEventByProviderId.mockResolvedValueOnce({ status });
      expect(await processPaddleEvent({ ...DEPS, paddle }, event())).toBe('duplicate');
    }
    expect(get).not.toHaveBeenCalled();
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
    expect(markBillingEventStatus).not.toHaveBeenCalled();
  });

  it('reprocesses a retry of a previously failed (or crash-stuck received) event', async () => {
    insertBillingEventIfNew.mockResolvedValue(false);
    const { paddle, get } = fakePaddle();
    for (const status of ['failed', 'received']) {
      getBillingEventByProviderId.mockResolvedValueOnce({ status });
      expect(await processPaddleEvent({ ...DEPS, paddle }, event())).toBe('processed');
    }
    expect(get).toHaveBeenCalledTimes(2);
    expect(markBillingEventStatus).toHaveBeenLastCalledWith(FAKE_DB, 'evt_01test', 'processed');
  });

  it('marks an unhandled event type ignored without calling Paddle', async () => {
    const { paddle, get } = fakePaddle();
    expect(
      await processPaddleEvent({ ...DEPS, paddle }, event({ event_type: 'transaction.completed' })),
    ).toBe('ignored');
    expect(insertBillingEventIfNew).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ type: 'transaction.completed', organizationId: null }),
    );
    expect(markBillingEventStatus).toHaveBeenCalledWith(FAKE_DB, 'evt_01test', 'ignored');
    expect(get).not.toHaveBeenCalled();
  });

  it('ignores a forged UNSIGNED organization_id: event row has organization null, no upsert, no product event', async () => {
    const { paddle } = fakePaddle(liveSubscription({ custom_data: { organization_id: ORG_ID } }));
    const outcome = await processPaddleEvent(
      { ...DEPS, paddle },
      event({
        data: { id: 'sub_test', custom_data: { organization_id: ORG_ID, plan: 'standard' } },
      }),
    );
    expect(outcome).toBe('ignored');
    expect(insertBillingEventIfNew.mock.calls[0]?.[1]).toMatchObject({ organizationId: null });
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
    expect(insertProductEvent).not.toHaveBeenCalled();
    expect(markBillingEventStatus).toHaveBeenCalledWith(FAKE_DB, 'evt_01test', 'ignored');
  });

  it('ignores a mis-signed organization_id (a valid signature for another org)', async () => {
    const forged = { organization_id: 'org_victim', organization_sig: SIGNED.organization_sig };
    const { paddle } = fakePaddle(liveSubscription({ custom_data: forged }));
    const outcome = await processPaddleEvent(
      { ...DEPS, paddle },
      event({ data: { id: 'sub_test', custom_data: forged } }),
    );
    expect(outcome).toBe('ignored');
    expect(insertBillingEventIfNew.mock.calls[0]?.[1]).toMatchObject({ organizationId: null });
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
  });

  it('trusts the re-fetched custom_data only when it is signed', async () => {
    const { paddle } = fakePaddle(liveSubscription({ custom_data: { organization_id: ORG_ID } }));
    const outcome = await processPaddleEvent(
      { ...DEPS, paddle },
      event({ data: { id: 'sub_test' } }),
    );
    expect(outcome).toBe('ignored');
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
  });

  it('falls back to the re-fetched custom_data when the payload lacks organization_id', async () => {
    const { paddle } = fakePaddle();
    const outcome = await processPaddleEvent(
      { ...DEPS, paddle },
      event({ data: { id: 'sub_test' } }),
    );
    expect(outcome).toBe('processed');
    expect(insertBillingEventIfNew.mock.calls[0]?.[1]).toMatchObject({ organizationId: null });
    expect(upsertSubscriptionByBillingCustomerId).toHaveBeenCalledWith(
      FAKE_DB,
      ORG_ID,
      expect.anything(),
    );
  });

  it('marks unresolvable organization as ignored (no write) when neither payload nor live entity carries it', async () => {
    const { paddle } = fakePaddle(liveSubscription({ custom_data: null }));
    const outcome = await processPaddleEvent(
      { ...DEPS, paddle },
      event({ data: { id: 'sub_test' } }),
    );
    expect(outcome).toBe('ignored');
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
    expect(markBillingEventStatus).toHaveBeenCalledWith(FAKE_DB, 'evt_01test', 'ignored');
  });

  it('throws on an unknown price id, marking the event failed and writing no row', async () => {
    const { paddle } = fakePaddle(liveSubscription({ items: [{ price: { id: 'pri_wrong' } }] }));
    await expect(processPaddleEvent({ ...DEPS, paddle }, event())).rejects.toThrow(
      /unknown Paddle price id/,
    );
    expect(markBillingEventStatus).toHaveBeenCalledWith(FAKE_DB, 'evt_01test', 'failed');
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
  });

  it('throws on a subscription with no items (no price to map)', async () => {
    const { paddle } = fakePaddle(liveSubscription({ items: [] }));
    await expect(processPaddleEvent({ ...DEPS, paddle }, event())).rejects.toThrow(
      /unknown Paddle price id/,
    );
  });

  it('marks the event failed and rethrows when the live re-fetch fails', async () => {
    const { paddle } = fakePaddle(new Error('paddle down'));
    await expect(processPaddleEvent({ ...DEPS, paddle }, event())).rejects.toThrow('paddle down');
    expect(markBillingEventStatus).toHaveBeenCalledWith(FAKE_DB, 'evt_01test', 'failed');
  });

  it('SEC-P9-03: cancels a duplicate subscription immediately when the org already has a live row under another customer', async () => {
    getSubscription.mockResolvedValue(
      row({ billingCustomerId: 'ctm_first', billingSubscriptionId: 'sub_first', status: 'active' }),
    );
    const { paddle, cancel } = fakePaddle(
      liveSubscription({ id: 'sub_dup', customer_id: 'ctm_dup' }),
    );
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), child: vi.fn() };
    const outcome = await processPaddleEvent(
      { ...DEPS, paddle, logger: logger as never },
      event({ data: { id: 'sub_dup', custom_data: SIGNED } }),
    );
    expect(outcome).toBe('duplicate_reconciled');
    expect(cancel).toHaveBeenCalledWith('sub_dup', { effective_from: 'immediately' });
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'billing.webhook.duplicate_checkout_reconciled',
      expect.objectContaining({
        keptBillingCustomerId: 'ctm_first',
        duplicateBillingCustomerId: 'ctm_dup',
        duplicateBillingSubscriptionId: 'sub_dup',
      }),
    );
    expect(markBillingEventStatus).toHaveBeenCalledWith(FAKE_DB, 'evt_01test', 'processed');
  });

  it('SEC-P9-03: an already-canceled duplicate is reconciled WITHOUT a cancel call (info log, row untouched)', async () => {
    getSubscription.mockResolvedValue(
      row({ billingCustomerId: 'ctm_first', billingSubscriptionId: 'sub_first', status: 'active' }),
    );
    const { paddle, cancel } = fakePaddle(
      liveSubscription({ id: 'sub_dup', customer_id: 'ctm_dup', status: 'canceled' }),
    );
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), child: vi.fn() };
    const outcome = await processPaddleEvent(
      { ...DEPS, paddle, logger: logger as never },
      event({ data: { id: 'sub_dup', custom_data: SIGNED } }),
    );
    expect(outcome).toBe('duplicate_reconciled');
    expect(cancel).not.toHaveBeenCalled();
    expect(upsertSubscriptionByBillingCustomerId).not.toHaveBeenCalled();
    expect(insertProductEvent).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'billing.webhook.duplicate_already_canceled',
      expect.objectContaining({ duplicateBillingSubscriptionId: 'sub_dup' }),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(markBillingEventStatus).toHaveBeenCalledWith(FAKE_DB, 'evt_01test', 'processed');
  });

  it('does NOT reconcile when the existing row is canceled (reactivation under a new customer proceeds)', async () => {
    getSubscription.mockResolvedValue(row({ billingCustomerId: 'ctm_old', status: 'canceled' }));
    const { paddle, cancel } = fakePaddle(liveSubscription({ customer_id: 'ctm_new' }));
    const outcome = await processPaddleEvent({ ...DEPS, paddle }, event());
    expect(outcome).toBe('processed');
    expect(cancel).not.toHaveBeenCalled();
    expect(upsertSubscriptionByBillingCustomerId.mock.calls[0]?.[2]).toMatchObject({
      billingCustomerId: 'ctm_new',
    });
  });

  it('propagates a TenantMismatch-style write failure as failed', async () => {
    upsertSubscriptionByBillingCustomerId.mockRejectedValue(new Error('tenant mismatch'));
    const { paddle } = fakePaddle();
    await expect(processPaddleEvent({ ...DEPS, paddle }, event())).rejects.toThrow(
      'tenant mismatch',
    );
    expect(markBillingEventStatus).toHaveBeenCalledWith(FAKE_DB, 'evt_01test', 'failed');
  });
});

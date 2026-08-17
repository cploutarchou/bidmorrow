import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FOUNDING_CAP,
  mapStripeSubscriptionStatus,
  planFromPriceId,
  priceIdForPlan,
  type PriceIds,
} from './plans';

const PRICE_IDS: PriceIds = {
  founding: 'price_founding_test',
  standard: 'price_standard_test',
};

describe('planFromPriceId / priceIdForPlan', () => {
  it('maps a known founding price id to the founding plan', () => {
    expect(planFromPriceId(PRICE_IDS, 'price_founding_test')).toBe('founding');
  });

  it('maps a known standard price id to the standard plan', () => {
    expect(planFromPriceId(PRICE_IDS, 'price_standard_test')).toBe('standard');
  });

  it('never fabricates a plan for an unrecognized price id', () => {
    expect(planFromPriceId(PRICE_IDS, 'price_unknown')).toBeNull();
  });

  it('round-trips plan -> price id -> plan', () => {
    expect(planFromPriceId(PRICE_IDS, priceIdForPlan(PRICE_IDS, 'founding'))).toBe('founding');
    expect(planFromPriceId(PRICE_IDS, priceIdForPlan(PRICE_IDS, 'standard'))).toBe('standard');
  });
});

describe('mapStripeSubscriptionStatus', () => {
  it('passes through the five statuses that exist in both vocabularies unchanged', () => {
    for (const status of ['trialing', 'active', 'past_due', 'canceled', 'unpaid'] as const) {
      expect(mapStripeSubscriptionStatus(status)).toBe(status);
    }
  });

  it('maps incomplete to unpaid (payment not yet completed, not entitled)', () => {
    expect(mapStripeSubscriptionStatus('incomplete')).toBe('unpaid');
  });

  it('maps incomplete_expired and paused to canceled (no active subscription)', () => {
    expect(mapStripeSubscriptionStatus('incomplete_expired')).toBe('canceled');
    expect(mapStripeSubscriptionStatus('paused')).toBe('canceled');
  });

  it('fails safe (canceled) for an unrecognized future Stripe status', () => {
    expect(mapStripeSubscriptionStatus('some_future_status')).toBe('canceled');
  });
});

describe('DEFAULT_FOUNDING_CAP', () => {
  it('matches docs/product-scope.md ("first 50 customers")', () => {
    expect(DEFAULT_FOUNDING_CAP).toBe(50);
  });
});

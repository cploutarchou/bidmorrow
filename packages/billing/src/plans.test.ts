import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FOUNDING_CAP,
  PLAN_PRICES,
  mapPaddleSubscriptionStatus,
  planFromPriceId,
  priceIdForPlan,
  type PriceIds,
} from './plans';

const PRICE_IDS: PriceIds = {
  founding: 'pri_founding_test',
  standard: 'pri_standard_test',
};

describe('planFromPriceId / priceIdForPlan', () => {
  it('maps a known founding price id to the founding plan', () => {
    expect(planFromPriceId(PRICE_IDS, 'pri_founding_test')).toBe('founding');
  });

  it('maps a known standard price id to the standard plan', () => {
    expect(planFromPriceId(PRICE_IDS, 'pri_standard_test')).toBe('standard');
  });

  it('never fabricates a plan for an unrecognized price id', () => {
    expect(planFromPriceId(PRICE_IDS, 'pri_unknown')).toBeNull();
  });

  it('round-trips plan -> price id -> plan', () => {
    expect(planFromPriceId(PRICE_IDS, priceIdForPlan(PRICE_IDS, 'founding'))).toBe('founding');
    expect(planFromPriceId(PRICE_IDS, priceIdForPlan(PRICE_IDS, 'standard'))).toBe('standard');
  });
});

describe('mapPaddleSubscriptionStatus', () => {
  it('passes through all five Paddle statuses unchanged', () => {
    for (const status of ['trialing', 'active', 'past_due', 'paused', 'canceled'] as const) {
      expect(mapPaddleSubscriptionStatus(status)).toBe(status);
    }
  });

  it('fails safe (canceled) for an unrecognized future Paddle status', () => {
    expect(mapPaddleSubscriptionStatus('some_future_status')).toBe('canceled');
    expect(mapPaddleSubscriptionStatus('unpaid')).toBe('canceled');
    expect(mapPaddleSubscriptionStatus('')).toBe('canceled');
  });
});

describe('PLAN_PRICES', () => {
  it('are the owner-decided flat EUR monthly prices, tax-exclusive', () => {
    expect(PLAN_PRICES.founding).toEqual({
      amountMinorUnits: 2900,
      currency: 'eur',
      interval: 'month',
      taxExclusive: true,
    });
    expect(PLAN_PRICES.standard).toEqual({
      amountMinorUnits: 4900,
      currency: 'eur',
      interval: 'month',
      taxExclusive: true,
    });
  });
});

describe('DEFAULT_FOUNDING_CAP', () => {
  it('matches docs/product-scope.md ("first 50 customers")', () => {
    expect(DEFAULT_FOUNDING_CAP).toBe(50);
  });
});

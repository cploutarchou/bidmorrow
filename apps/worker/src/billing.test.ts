/**
 * `resolveBillingConfig` unit tests (Phase 9 composition, apps/worker/src/
 * billing.ts) — the shared `null` (not-configured) branch every
 * `/api/billing/*` route's 503 check depends on. Deliberately a PLAIN
 * function-level test (no HTTP, no D1): the D1 integration suite
 * (billing.d1.test.ts) runs against a fixed workerd env that always
 * provisions fake Stripe test-mode sentinels (vitest.config.ts), so the
 * `not_configured` HTTP branch itself is not reachable there — this file
 * covers the guard's actual logic directly instead of skipping it.
 */
import { describe, expect, it } from 'vitest';

import { resolveBillingConfig } from './billing';
import type { Env } from './env';

const BASE_ENV = {
  APP_BASE_URL: 'https://bidmorrow.local',
} as unknown as Env;

describe('resolveBillingConfig', () => {
  it('returns null when STRIPE_SECRET_KEY is missing', () => {
    const env = {
      ...BASE_ENV,
      STRIPE_PRICE_FOUNDING_MONTHLY: 'price_fake_founding',
      STRIPE_PRICE_STANDARD_MONTHLY: 'price_fake_standard',
    } as unknown as Env;
    expect(resolveBillingConfig(env)).toBeNull();
  });

  it('returns null when STRIPE_PRICE_FOUNDING_MONTHLY is missing', () => {
    const env = {
      ...BASE_ENV,
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_PRICE_STANDARD_MONTHLY: 'price_fake_standard',
    } as unknown as Env;
    expect(resolveBillingConfig(env)).toBeNull();
  });

  it('returns null when STRIPE_PRICE_STANDARD_MONTHLY is missing', () => {
    const env = {
      ...BASE_ENV,
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_PRICE_FOUNDING_MONTHLY: 'price_fake_founding',
    } as unknown as Env;
    expect(resolveBillingConfig(env)).toBeNull();
  });

  it('returns a config (never fabricating a price id) when all three are present', () => {
    const env = {
      ...BASE_ENV,
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_PRICE_FOUNDING_MONTHLY: 'price_fake_founding',
      STRIPE_PRICE_STANDARD_MONTHLY: 'price_fake_standard',
    } as unknown as Env;
    const config = resolveBillingConfig(env);
    expect(config).not.toBeNull();
    expect(config?.priceIds).toEqual({
      founding: 'price_fake_founding',
      standard: 'price_fake_standard',
    });
    expect(config?.appBaseUrl).toBe('https://bidmorrow.local');
  });
});

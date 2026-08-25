/**
 * `resolveBillingConfig` unit tests (apps/worker/src/billing.ts, ADR-0011)
 * — the shared `null` (not-configured) branch every `/api/billing/*`
 * route's 503 check depends on. Deliberately a PLAIN function-level test
 * (no HTTP, no D1): the D1 integration suite (billing.d1.test.ts) runs
 * against a fixed workerd env that always provisions fake Paddle sandbox
 * sentinels (vitest.config.ts), so the `not_configured` HTTP branch itself
 * is not reachable there — this file covers the guard's logic directly.
 */
import { describe, expect, it } from 'vitest';

import { resolveBillingConfig, resolvePaddleEnvironment } from './billing';
import type { Env } from './env';

const FULL = {
  APP_BASE_URL: 'https://bidmorrow.local',
  PADDLE_API_KEY: 'pdl_sdbx_apikey_fake',
  PADDLE_CLIENT_TOKEN: 'test_fake_token',
  PADDLE_ENVIRONMENT: 'sandbox',
  PADDLE_PRICE_FOUNDING_MONTHLY: 'pri_fake_founding',
  PADDLE_PRICE_STANDARD_MONTHLY: 'pri_fake_standard',
};

function envWithout(name: keyof typeof FULL): Env {
  const copy: Record<string, string> = { ...FULL };
  delete copy[name];
  return copy as unknown as Env;
}

describe('resolvePaddleEnvironment', () => {
  it('accepts exactly sandbox and production', () => {
    expect(resolvePaddleEnvironment('sandbox')).toBe('sandbox');
    expect(resolvePaddleEnvironment('production')).toBe('production');
  });

  it('never guesses for anything else', () => {
    expect(resolvePaddleEnvironment(undefined)).toBeNull();
    expect(resolvePaddleEnvironment('')).toBeNull();
    expect(resolvePaddleEnvironment('live')).toBeNull();
    expect(resolvePaddleEnvironment('Sandbox')).toBeNull();
  });
});

describe('resolveBillingConfig', () => {
  it.each([
    'PADDLE_API_KEY',
    'PADDLE_CLIENT_TOKEN',
    'PADDLE_ENVIRONMENT',
    'PADDLE_PRICE_FOUNDING_MONTHLY',
    'PADDLE_PRICE_STANDARD_MONTHLY',
  ] as const)('returns null when %s is missing', (name) => {
    expect(resolveBillingConfig(envWithout(name))).toBeNull();
  });

  it('returns null for an unrecognised PADDLE_ENVIRONMENT rather than defaulting', () => {
    const env = { ...FULL, PADDLE_ENVIRONMENT: 'live' } as unknown as Env;
    expect(resolveBillingConfig(env)).toBeNull();
  });

  it('returns a config (never fabricating a price id) when everything is present', () => {
    const config = resolveBillingConfig(FULL as unknown as Env);
    expect(config).not.toBeNull();
    expect(config?.priceIds).toEqual({
      founding: 'pri_fake_founding',
      standard: 'pri_fake_standard',
    });
    expect(config?.environment).toBe('sandbox');
    expect(config?.clientToken).toBe('test_fake_token');
    expect(config?.appBaseUrl).toBe('https://bidmorrow.local');
    expect(config?.paddle.subscriptions).toBeDefined();
  });
});

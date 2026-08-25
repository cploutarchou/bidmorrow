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

import { normalizeSecret, resolveBillingConfig, resolvePaddleEnvironment } from './billing';
import type { Env } from './env';

const FULL = {
  APP_BASE_URL: 'https://bidmorrow.local',
  PADDLE_API_KEY: 'pdl_sdbx_apikey_fake_not_real',
  PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_fake',
  PADDLE_CLIENT_TOKEN: 'test_fake_token',
  PADDLE_ENVIRONMENT: 'sandbox',
  PADDLE_PRICE_FOUNDING_MONTHLY: 'pri_01m0wx38ymack0vxmqvtadddg9',
  PADDLE_PRICE_STANDARD_MONTHLY: 'pri_01m0wx39a5dkx4fpr7pexbwv6b',
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
    'PADDLE_WEBHOOK_SECRET',
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
      founding: 'pri_01m0wx38ymack0vxmqvtadddg9',
      standard: 'pri_01m0wx39a5dkx4fpr7pexbwv6b',
    });
    expect(config?.environment).toBe('sandbox');
    expect(config?.clientToken).toBe('test_fake_token');
    expect(config?.webhookSecret).toBe('pdl_ntfset_fake');
    expect(config?.appBaseUrl).toBe('https://bidmorrow.local');
    expect(config?.paddle.subscriptions).toBeDefined();
  });

  it('tolerates pasted whitespace, newlines and wrapping quotes around secrets', () => {
    const env = {
      ...FULL,
      PADDLE_API_KEY: '  pdl_sdbx_apikey_fake_not_real\n',
      PADDLE_PRICE_FOUNDING_MONTHLY: '"pri_01m0wx38ymack0vxmqvtadddg9"',
      PADDLE_ENVIRONMENT: 'sandbox\n',
      PADDLE_WEBHOOK_SECRET: ' pdl_ntfset_fake ',
    } as unknown as Env;
    const config = resolveBillingConfig(env);
    expect(config?.priceIds.founding).toBe('pri_01m0wx38ymack0vxmqvtadddg9');
    expect(config?.webhookSecret).toBe('pdl_ntfset_fake');
    expect(config?.environment).toBe('sandbox');
  });

  it.each([
    ['a client token in PADDLE_API_KEY', { PADDLE_API_KEY: 'test_clienttoken_placeholder' }],
    [
      'a Bearer prefix in PADDLE_API_KEY',
      { PADDLE_API_KEY: 'Bearer pdl_sdbx_apikey_fake_not_real' },
    ],
    [
      'a product id where a price id belongs',
      { PADDLE_PRICE_STANDARD_MONTHLY: 'pro_01m0wx38tjejcm7tvx35paz8rp' },
    ],
    ['an empty (whitespace-only) PADDLE_API_KEY', { PADDLE_API_KEY: '   ' }],
  ])('returns null (not_configured) for %s instead of a 500 per request', (_label, patch) => {
    expect(resolveBillingConfig({ ...FULL, ...patch } as unknown as Env)).toBeNull();
  });
});

describe('normalizeSecret', () => {
  it('trims, unquotes and treats empty as unset', () => {
    expect(normalizeSecret(undefined)).toBeUndefined();
    expect(normalizeSecret('')).toBeUndefined();
    expect(normalizeSecret('\n')).toBeUndefined();
    expect(normalizeSecret(' x ')).toBe('x');
    expect(normalizeSecret('"x"')).toBe('x');
    expect(normalizeSecret("' x '")).toBe('x');
    expect(normalizeSecret('"')).toBe('"');
  });
});

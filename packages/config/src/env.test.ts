import { describe, expect, it } from 'vitest';

import { EnvValidationError, FEATURE_FLAG_KEYS, parseEnv } from './index';

const DEPLOYED_SECRETS = {
  BETTER_AUTH_SECRET: 'sentinel-auth-secret-value',
  BETTER_AUTH_URL: 'https://app.example.com',
  RESEND_API_KEY: 're_sentinel',
  EMAIL_FROM: 'BidMorrow <digest@example.com>',
  SUPPORT_EMAIL: 'support@example.com',
  STRIPE_SECRET_KEY: 'sk_test_sentinel',
  STRIPE_WEBHOOK_SECRET: 'whsec_sentinel',
  STRIPE_PRICE_FOUNDING_MONTHLY: 'price_founding',
  STRIPE_PRICE_STANDARD_MONTHLY: 'price_standard',
  ADMIN_EMAILS: 'admin@example.com',
  TED_API_BASE_URL: 'https://api.ted.europa.eu',
};

describe('parseEnv', () => {
  it('parses a minimal local environment (secrets optional)', () => {
    const config = parseEnv({
      APP_ENV: 'local',
      APP_BASE_URL: 'http://localhost:8787',
    });
    expect(config.APP_ENV).toBe('local');
    expect(config.APP_BASE_URL).toBe('http://localhost:8787');
    expect(config.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it('parses a fully populated production environment', () => {
    const config = parseEnv({
      APP_ENV: 'production',
      APP_BASE_URL: 'https://bidmorrow.com',
      ...DEPLOYED_SECRETS,
    });
    expect(config.APP_ENV).toBe('production');
    expect(config.TED_API_BASE_URL).toBe('https://api.ted.europa.eu');
  });

  it('aggregates missing names in production, listing names but never values', () => {
    const record = {
      APP_ENV: 'production',
      APP_BASE_URL: 'https://bidmorrow.com',
      BETTER_AUTH_SECRET: 'sentinel-auth-secret-value',
    };
    let caught: unknown;
    try {
      parseEnv(record);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    const error = caught as EnvValidationError;
    expect(error.missing).toContain('STRIPE_SECRET_KEY');
    expect(error.missing).toContain('RESEND_API_KEY');
    expect(error.missing).toContain('TED_API_BASE_URL');
    expect(error.missing).not.toContain('BETTER_AUTH_SECRET');
    expect(error.message).toContain('STRIPE_SECRET_KEY');
    // Never leak values — not even ones that were provided.
    expect(error.message).not.toContain('sentinel-auth-secret-value');
    expect(error.message).not.toContain('bidmorrow.com');
  });

  it('reports invalid (present but malformed) variables by name only', () => {
    let caught: unknown;
    try {
      parseEnv({ APP_ENV: 'local', APP_BASE_URL: 'not a url' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    const error = caught as EnvValidationError;
    expect(error.invalid).toEqual(['APP_BASE_URL']);
    expect(error.missing).toEqual([]);
    expect(error.message).not.toContain('not a url');
  });

  it('treats empty strings as missing and rejects unknown APP_ENV', () => {
    let caught: unknown;
    try {
      parseEnv({ APP_ENV: 'prod', APP_BASE_URL: '' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    const error = caught as EnvValidationError;
    expect(error.invalid).toContain('APP_ENV');
    expect(error.missing).toContain('APP_BASE_URL');
  });
});

describe('feature flag keys', () => {
  it('exposes the admin-editable flag keys', () => {
    expect(FEATURE_FLAG_KEYS).toEqual([
      'founding_plan_open',
      'founding_cap',
      'ingestion_paused',
      'digest_paused',
      'ingestion_cpv_scope',
      'entitlement_enforced',
      'stripe_tax_enabled',
      'prelaunch',
      'launch_date',
      'fetch_retry_attempts_suspended',
    ]);
  });
});

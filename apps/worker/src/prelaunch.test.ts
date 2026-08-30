/**
 * Pre-launch gate (prelaunch.ts): pure resolver defaults/validation, the
 * public-config endpoint, and the sign-up gate — the latter two run inside
 * workerd against real local D1 (flag rows written via setFeatureFlag).
 */
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { FLAG_PRELAUNCH, DEFAULT_LAUNCH_DATE } from '@bidmorrow/config';
import { createDb, setFeatureFlag } from '@bidmorrow/db';
import { resolvePrelaunchState } from './prelaunch';
import './index';

describe('resolvePrelaunchState (pure)', () => {
  it('defaults by environment when the flag is absent: production closed, others open', () => {
    expect(resolvePrelaunchState(null, null, 'production').prelaunch).toBe(true);
    expect(resolvePrelaunchState(null, null, 'staging').prelaunch).toBe(false);
    expect(resolvePrelaunchState(null, null, 'local').prelaunch).toBe(false);
    expect(resolvePrelaunchState(null, null, 'test').prelaunch).toBe(false);
  });

  it('an explicit flag value overrides the environment default in both directions', () => {
    expect(resolvePrelaunchState('false', null, 'production').prelaunch).toBe(false);
    expect(resolvePrelaunchState('true', null, 'local').prelaunch).toBe(true);
  });

  it('malformed values fall back to the environment default and the default launch date', () => {
    expect(resolvePrelaunchState('"yes"', '42', 'production')).toEqual({
      prelaunch: true,
      launchDate: DEFAULT_LAUNCH_DATE,
    });
    expect(resolvePrelaunchState(null, '"not a date"', 'local').launchDate).toBe(
      DEFAULT_LAUNCH_DATE,
    );
  });

  it('a valid launch_date value wins over the default', () => {
    expect(resolvePrelaunchState(null, '"2026-09-15T00:00:00Z"', 'local').launchDate).toBe(
      '2026-09-15T00:00:00Z',
    );
  });
});

describe('pre-launch gates (workerd + local D1)', () => {
  beforeEach(async () => {
    // Test env is non-production, so absent flag = open; each test sets
    // the flag explicitly for the state it needs.
    await setFeatureFlag(createDb(env.DB), {
      key: FLAG_PRELAUNCH,
      valueJson: 'false',
      description: 'test reset',
    });
  });

  it('GET /api/public-config returns the open state with the default launch date', async () => {
    const response = await exports.default.fetch('https://bidmorrow.local/api/public-config');
    expect(response.status).toBe(200);
    // `paddle` carries the PUBLIC Paddle.js token/environment (ADR-0011);
    // the sentinel values come from vitest.config.ts.
    expect(await response.json()).toEqual({
      prelaunch: false,
      launchDate: DEFAULT_LAUNCH_DATE,
      paddle: { clientToken: 'test_fake_client_token', environment: 'sandbox' },
    });
  });

  it('POST /api/auth/sign-up/email is refused with 403 signups_closed while prelaunch is on', async () => {
    await setFeatureFlag(createDb(env.DB), {
      key: FLAG_PRELAUNCH,
      valueJson: 'true',
      description: 'test: close signups',
    });
    const response = await exports.default.fetch('https://bidmorrow.local/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'T', email: 't@example.com', password: 'passw0rd!x' }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('signups_closed');
  });

  it('lets an ADMIN_EMAILS address sign up while prelaunch is on (case-insensitive)', async () => {
    await setFeatureFlag(createDb(env.DB), {
      key: FLAG_PRELAUNCH,
      valueJson: 'true',
      description: 'test: close signups',
    });
    // vitest.config.ts binds ADMIN_EMAILS as 'Admin@Example.test'.
    const response = await exports.default.fetch('https://bidmorrow.local/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Admin', email: 'admin@example.test', password: 'passw0rd!x' }),
    });
    // Reached Better Auth (200 created); the gate's 403 never fired.
    expect(response.status).toBe(200);
  });

  it('keeps refusing a malformed body while prelaunch is on', async () => {
    await setFeatureFlag(createDb(env.DB), {
      key: FLAG_PRELAUNCH,
      valueJson: 'true',
      description: 'test: close signups',
    });
    const response = await exports.default.fetch('https://bidmorrow.local/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(403);
  });

  it('the gate does not block other auth routes while prelaunch is on', async () => {
    await setFeatureFlag(createDb(env.DB), {
      key: FLAG_PRELAUNCH,
      valueJson: 'true',
      description: 'test: close signups',
    });
    // Sign-in with unknown credentials must reach Better Auth (401-family
    // response from the handler, never the gate's 403 signups_closed).
    const response = await exports.default.fetch('https://bidmorrow.local/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
    });
    expect(response.status).not.toBe(403);
  });

  it('sign-up passes through to Better Auth when prelaunch is off', async () => {
    const response = await exports.default.fetch('https://bidmorrow.local/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Prelaunch Test',
        email: `prelaunch-${String(Date.now())}@example.com`,
        password: 'a-long-enough-password-1',
        callbackURL: '/verify-email',
      }),
    });
    // Better Auth handled it (created or validation error) — not the gate.
    expect(response.status).not.toBe(403);
  });
});

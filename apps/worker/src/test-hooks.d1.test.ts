/**
 * Phase 12 stage A: `/api/test/*` double-gate proof, real workerd (mirrors
 * every other D1 integration test's `exports.default.fetch` pattern). The
 * worker vitest config (`vitest.config.ts`) deliberately does NOT set
 * `E2E_TEST_HOOKS` — the default `wrangler.jsonc` `vars.APP_ENV` is `local`
 * (satisfying half the gate), so this suite proves the OTHER half: with
 * `E2E_TEST_HOOKS` unset, every `/api/test/*` route 404s exactly like an
 * unknown path, never leaking that the hooks exist. The positive
 * (hooks-enabled) path is exercised by Playwright E2E against `wrangler
 * dev` with `.dev.vars`' `E2E_TEST_HOOKS=true` (tests/e2e/README.md), not
 * here — this file's job is the security-relevant negative case.
 */
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { isE2ETestHooksEnabled } from './test-hooks-gate';
import type { Env } from './env';

import './index';

const BASE = 'https://bidmorrow.local';

async function fetchApi(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${BASE}${path}`, init);
}

function fakeEnv(overrides: Partial<Env>): Env {
  return {
    DB: undefined,
    ASSETS: undefined,
    APP_ENV: 'production',
    APP_BASE_URL: 'https://bidmorrow.com',
    BETTER_AUTH_SECRET: 'x',
    BETTER_AUTH_URL: 'https://bidmorrow.com',
    SNAPSHOTS: undefined,
    INGEST_QUEUE: undefined,
    MATCH_QUEUE: undefined,
    DIGEST_QUEUE: undefined,
    ...overrides,
  } as unknown as Env;
}

describe('isE2ETestHooksEnabled (pure gate predicate)', () => {
  it('false when E2E_TEST_HOOKS is unset', () => {
    expect(isE2ETestHooksEnabled(fakeEnv({ APP_ENV: 'local' }))).toBe(false);
  });

  it('false when APP_ENV is staging/production, even if E2E_TEST_HOOKS=true', () => {
    expect(isE2ETestHooksEnabled(fakeEnv({ APP_ENV: 'staging', E2E_TEST_HOOKS: 'true' }))).toBe(
      false,
    );
    expect(isE2ETestHooksEnabled(fakeEnv({ APP_ENV: 'production', E2E_TEST_HOOKS: 'true' }))).toBe(
      false,
    );
  });

  it('false when E2E_TEST_HOOKS is any value other than the exact string "true"', () => {
    expect(isE2ETestHooksEnabled(fakeEnv({ APP_ENV: 'local', E2E_TEST_HOOKS: 'TRUE' }))).toBe(
      false,
    );
    expect(isE2ETestHooksEnabled(fakeEnv({ APP_ENV: 'local', E2E_TEST_HOOKS: '1' }))).toBe(false);
  });

  it('true only when both conditions hold', () => {
    expect(isE2ETestHooksEnabled(fakeEnv({ APP_ENV: 'local', E2E_TEST_HOOKS: 'true' }))).toBe(
      true,
    );
    expect(isE2ETestHooksEnabled(fakeEnv({ APP_ENV: 'test', E2E_TEST_HOOKS: 'true' }))).toBe(true);
  });
});

describe('/api/test/* with E2E_TEST_HOOKS unset (this suite\'s real worker env)', () => {
  it('GET /api/test/mailbox 404s exactly like an unknown route', async () => {
    const [hooksResponse, unknownResponse] = await Promise.all([
      fetchApi('/api/test/mailbox'),
      fetchApi('/api/definitely-unknown-route'),
    ]);
    expect(hooksResponse.status).toBe(404);
    expect(unknownResponse.status).toBe(404);
    const hooksBody = (await hooksResponse.json()) as { error: string };
    const unknownBody = (await unknownResponse.json()) as { error: string };
    expect(hooksBody.error).toBe('not_found');
    expect(hooksBody.error).toBe(unknownBody.error);
  });

  it('POST /api/test/score-now 404s (never reaches the session check)', async () => {
    const response = await fetchApi('/api/test/score-now', { method: 'POST' });
    expect(response.status).toBe(404);
  });
});

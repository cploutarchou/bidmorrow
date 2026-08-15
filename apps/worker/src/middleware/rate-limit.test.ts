/**
 * `rateLimitOrgApi` (docs/security.md C7): the native Workers rate-limit
 * binding is exercised against a hand-built stub implementing the
 * `RateLimit` interface (`{ limit({key}) }`) rather than a real
 * `API_RATE_LIMITER` provisioning — @cloudflare/vitest-pool-workers's
 * wrangler.jsonc-driven local bindings do not provision a fake rate
 * limiter, and the middleware's own contract (env.ts: "middleware must
 * tolerate its absence rather than fail closed or open silently") is
 * exactly what these tests hold it to, so a stub binding object is the
 * correct level to test at regardless.
 *
 * A minimal standalone Hono app is used (not the full `apps/worker`
 * composition root) — `rateLimitOrgApi` only reads `c.env.API_RATE_LIMITER`,
 * `c.req.header('cf-connecting-ip')`, and `c.get('logger')`, so a tiny app
 * that sets those three things is a faithful, lower-friction harness than
 * routing a real request through session/organization gating first.
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@bidmorrow/observability';

import { rateLimitOrgApi } from './rate-limit';
import type { AppBindings } from '../env';

function buildApp(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test-request-id');
    c.set('logger', createLogger({ request_id: 'test-request-id' }));
    await next();
  });
  app.use('*', rateLimitOrgApi);
  app.get('/probe', (c) => c.json({ ok: true }));
  return app;
}

function stubLimiter(success: boolean): RateLimit {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

describe('rateLimitOrgApi', () => {
  it('proceeds to the handler when the limiter allows the request', async () => {
    const app = buildApp();
    const response = await app.request('/probe', {}, { API_RATE_LIMITER: stubLimiter(true) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('returns a 429 with the app error-envelope shape when the limiter rejects', async () => {
    const app = buildApp();
    const response = await app.request('/probe', {}, { API_RATE_LIMITER: stubLimiter(false) });

    expect(response.status).toBe(429);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as Record<string, unknown>;
    // Matches the app-wide error envelope (404/413/500 all carry
    // request_id) so 429s are correlatable in support tickets.
    expect(body).toEqual({ error: 'rate_limited', request_id: 'test-request-id' });
  });

  it('keys the limiter call on the cf-connecting-ip header', async () => {
    const limiter = stubLimiter(true);
    const app = buildApp();
    await app.request(
      '/probe',
      { headers: { 'cf-connecting-ip': '203.0.113.7' } },
      { API_RATE_LIMITER: limiter },
    );

    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
  });

  it('falls back to a constant key when cf-connecting-ip is absent (e.g. local dev)', async () => {
    const limiter = stubLimiter(true);
    const app = buildApp();
    await app.request('/probe', {}, { API_RATE_LIMITER: limiter });

    expect(limiter.limit).toHaveBeenCalledWith({ key: 'unknown' });
  });

  describe('fail-open when the binding is not configured (documented intentional behavior)', () => {
    it('proceeds to the handler rather than failing closed', async () => {
      const app = buildApp();
      // No API_RATE_LIMITER key at all in the env passed to .request(), so
      // `c.env.API_RATE_LIMITER` is undefined — mirrors an environment that
      // never provisioned the binding.
      const response = await app.request('/probe', {}, {});

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    });

    it('logs the missing-binding warning only once per isolate across repeated requests', async () => {
      const app = buildApp();
      // The middleware builds its warning via `c.get('logger').warn(...)`,
      // which (per @bidmorrow/observability's lint policy) emits through
      // `console.warn` — spy there rather than on a logger instance the
      // middleware never sees.
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        await app.request('/probe', {}, {});
        await app.request('/probe', {}, {});
        await app.request('/probe', {}, {});

        const missingBindingLogs = consoleWarnSpy.mock.calls.filter(
          (call: unknown[]) =>
            typeof call[0] === 'string' &&
            call[0].includes('API_RATE_LIMITER binding is not configured'),
        );
        // Module-level `missingBindingLogged` is a per-isolate flag — it may
        // already be `true` from an earlier test/request in this same
        // isolate (dedup is cross-test by design), so this only asserts the
        // upper bound the dedup contract promises: never once per request.
        expect(missingBindingLogs.length).toBeLessThanOrEqual(1);
      } finally {
        consoleWarnSpy.mockRestore();
      }
    });
  });
});

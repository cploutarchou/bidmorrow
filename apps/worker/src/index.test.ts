/**
 * Integration tests running inside workerd via @cloudflare/vitest-pool-workers.
 *
 * `exports.default` is the Worker's default export (wrangler.jsonc `main`),
 * exposed as a loopback service stub; `env` provides real local bindings
 * (miniflare-backed D1). Migrations are applied per test file by
 * src/test/apply-migrations.ts.
 */
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
// Importing the entry point makes watch mode re-run these tests when it changes.
import './index';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('GET /api/health/live', () => {
  it('returns 200 with status ok', async () => {
    const response = await exports.default.fetch('https://bidmorrow.local/api/health/live');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /api/health/ready', () => {
  it('returns 200 with db ok and ingestion-staleness fields against the local D1 database', async () => {
    const response = await exports.default.fetch('https://bidmorrow.local/api/health/ready');
    expect(response.status).toBe(200);
    // No ingestion has ever run against this fresh database — stale is true
    // and there is no successful run yet, but readiness itself is `ok`.
    expect(await response.json()).toEqual({
      status: 'ok',
      db: 'ok',
      lastSuccessfulIngestionAt: null,
      stale: true,
    });
  });

  it('runs against a migrated database (core schema applied, bootstrap dropped)', async () => {
    // 0002_core_schema creates the real schema and drops the 0001 `_bootstrap`
    // placeholder, so a fully migrated database has `organizations` and no
    // `_bootstrap`. (The exhaustive table check lives in packages/db's
    // migrations.d1.test.ts; this is the worker-side smoke sentinel.)
    const organizations = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organizations'",
    ).first<{ name: string }>();
    expect(organizations?.name).toBe('organizations');

    const bootstrap = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_bootstrap'",
    ).first<{ name: string }>();
    expect(bootstrap).toBeNull();
  });
});

describe('request correlation', () => {
  it('returns a fresh UUID x-request-id header per request', async () => {
    const first = await exports.default.fetch('https://bidmorrow.local/api/health/live');
    const second = await exports.default.fetch('https://bidmorrow.local/api/health/live');
    const firstId = first.headers.get('x-request-id');
    const secondId = second.headers.get('x-request-id');
    expect(firstId).toMatch(UUID_PATTERN);
    expect(secondId).toMatch(UUID_PATTERN);
    expect(firstId).not.toBe(secondId);
  });
});

describe('unknown API routes', () => {
  it('returns 404 JSON for /api/does-not-exist', async () => {
    const response = await exports.default.fetch('https://bidmorrow.local/api/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as { error: string; request_id: string };
    expect(body.error).toBe('not_found');
    expect(body.request_id).toMatch(UUID_PATTERN);
  });
});

describe('security headers (docs/security.md C3/C4)', () => {
  it('sets a strict Content-Security-Policy', async () => {
    const response = await exports.default.fetch('https://bidmorrow.local/api/health/live');
    const csp = response.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
  });

  it('sets the C4 header baseline', async () => {
    const response = await exports.default.fetch('https://bidmorrow.local/api/health/live');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('permissions-policy')).toContain('camera=()');
  });
});

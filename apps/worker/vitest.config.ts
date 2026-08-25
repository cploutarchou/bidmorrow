/**
 * Workers Vitest integration (v0.21 Vite-plugin style): tests run inside
 * workerd with the bindings declared in wrangler.jsonc (real local D1).
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      // wrangler.jsonc points assets at ../web/dist, which only exists after
      // the web app has been built; create it so config parsing never fails
      // on a clean checkout. (Tests exercise /api/* only — `exports` does not
      // serve assets anyway.)
      mkdirSync(fileURLToPath(new URL('../web/dist', import.meta.url)), { recursive: true });

      const migrations = await readD1Migrations(
        fileURLToPath(new URL('../../migrations', import.meta.url)),
      );

      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            // Test-only binding so the setup file can apply migrations.
            TEST_MIGRATIONS: migrations,
            // Pin the vars this suite depends on EXPLICITLY: wrangler config
            // loading also reads apps/worker/.dev.vars when present (e.g.
            // the Playwright run's generated one, scripts/e2e-write-dev-vars
            // .mjs — BETTER_AUTH_URL=http://127.0.0.1:8787, E2E_TEST_HOOKS=
            // true), and without these overrides a leftover .dev.vars flips
            // trusted origins / test-hook gating and fails 80+ tests with
            // "Invalid origin". Explicit miniflare bindings always win.
            APP_ENV: 'local',
            APP_BASE_URL: 'http://localhost:8787',
            BETTER_AUTH_URL: 'http://localhost:8787',
            E2E_TEST_HOOKS: '',
            // Clearly-fake test secret (never a real value) — Better Auth
            // requires >= 32 chars. wrangler.jsonc `vars` never carries this.
            BETTER_AUTH_SECRET: 'test-only-secret-do-not-use-in-prod-00000000',
            // Test-only INTERNAL_ADMIN allowlist (docs/security.md C6) —
            // mixed-case on purpose (SEC-P4-06d): the allowlist match is
            // case-insensitive (admin.ts lowercases both sides), and Better
            // Auth stores/returns emails lowercased, so this also proves the
            // allowlist side of that comparison, not just the trivial
            // exact-match case. Admin-gate tests sign in with the lowercase
            // form of this same address.
            ADMIN_EMAILS: 'Admin@Example.test',
            // Clearly-fake Paddle sandbox sentinels (never real credentials
            // — HUMAN_DECISION_BLOCKERS.md item 4). Enables `/api/billing/*`
            // and `/api/webhooks/paddle` to construct a client so signature
            // verification (pure local HMAC, no network) and pre-network
            // guard paths (409s, role/auth gates) are D1-testable; any code
            // path that would actually reach Paddle's network API is
            // deliberately NOT exercised here — that boundary is unit-tested
            // in packages/billing with an injected fake client instead.
            PADDLE_API_KEY: 'pdl_sdbx_apikey_fake_for_worker_tests_only',
            PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_fake_for_worker_tests_only',
            PADDLE_CLIENT_TOKEN: 'test_fake_client_token',
            PADDLE_ENVIRONMENT: 'sandbox',
            PADDLE_PRICE_FOUNDING_MONTHLY: 'pri_01fakefoundingtest00000000',
            PADDLE_PRICE_STANDARD_MONTHLY: 'pri_01fakestandardtest00000000',
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./src/test/apply-migrations.ts'],
    // workerd startup + migration application is heavy (tens of seconds of
    // import/transform) and much slower on constrained CI runners than
    // locally, so the default 5s per-test/hook timeout false-fails
    // slow-but-correct D1 tests under load. A generous ceiling prevents
    // that without masking real failures (a broken test still fails).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

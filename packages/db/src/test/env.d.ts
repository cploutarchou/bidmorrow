/**
 * Test-only binding types for the @bidmorrow/db D1 integration tests.
 *
 * `DB` mirrors the binding in wrangler.test.jsonc; `TEST_MIGRATIONS` is
 * injected by vitest.config.ts (miniflare `bindings`) and consumed by
 * apply-migrations.ts. Neither exists outside the test harness.
 */
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}

/**
 * Test-only binding types. `TEST_MIGRATIONS` is injected by vitest.config.ts
 * (miniflare `bindings`) and consumed by apply-migrations.ts; it does not
 * exist in the deployed Worker.
 */
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}

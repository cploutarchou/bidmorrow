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

/**
 * Vite `?raw` imports (used by src/ingestion.d1.test.ts to load real eForms
 * XML fixtures as strings): the pool-workers runtime is sandboxed workerd,
 * not Node, so `node:fs` cannot read arbitrary host files at test time —
 * Vite inlines the file content at build/transform time instead.
 */
declare module '*.xml?raw' {
  const content: string;
  export default content;
}

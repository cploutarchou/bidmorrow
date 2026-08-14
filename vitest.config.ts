import { configDefaults, defineConfig } from 'vitest/config';

// Root Vitest config (Vitest 4 "projects" style).
//
// Deliberately does NOT include apps/worker or the `*.d1.test.ts` files in
// packages/db: those run inside workerd (real local D1) via
// @cloudflare/vitest-pool-workers behind their own configs
// (apps/worker/vitest.config.ts, packages/db/vitest.config.ts). The root
// `pnpm test` script chains all three:
//   vitest run && pnpm --filter @bidmorrow/worker test && pnpm --filter @bidmorrow/db test
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/web/src/**/*.test.ts',
            // Cross-cutting suites (tests/README.md): contract, integration,
            // security — e.g. the tenant-isolation structural contract test.
            'tests/**/*.test.ts',
          ],
          // D1 integration tests need workerd; they run under packages/db's
          // own vitest config, never in this node project. tests/e2e is
          // Playwright (root playwright.config.ts), not Vitest.
          exclude: [...configDefaults.exclude, '**/*.d1.test.ts', 'tests/e2e/**'],
        },
      },
    ],
  },
});

import { defineConfig } from 'vitest/config';

// Root Vitest config (Vitest 4 "projects" style).
//
// Deliberately does NOT include apps/worker: the worker's tests run inside
// workerd via @cloudflare/vitest-pool-workers and live behind the worker's own
// apps/worker/vitest.config.ts. The root `pnpm test` script chains both:
//   vitest run && pnpm --filter @bidmorrow/worker test
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
        },
      },
    ],
  },
});

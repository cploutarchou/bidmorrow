/**
 * Workers Vitest integration for @bidmorrow/db (v0.21 Vite-plugin style,
 * mirroring apps/worker/vitest.config.ts): tests run inside workerd with a
 * real local D1 binding declared in wrangler.test.jsonc.
 *
 * Only `src/**\/*.d1.test.ts` files run here — they need workerd. Plain
 * `*.test.ts` unit tests in this package keep running under the root
 * vitest.config.ts node project, which excludes the `.d1.` suffix.
 */
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        fileURLToPath(new URL('../../migrations', import.meta.url)),
      );

      return {
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          // Test-only binding so the setup file can apply migrations.
          bindings: { TEST_MIGRATIONS: migrations },
        },
      };
    }),
  ],
  test: {
    include: ['src/**/*.d1.test.ts'],
    setupFiles: ['./src/test/apply-migrations.ts'],
  },
});

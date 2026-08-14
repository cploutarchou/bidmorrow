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
            // Clearly-fake test secret (never a real value) — Better Auth
            // requires >= 32 chars. wrangler.jsonc `vars` never carries this.
            BETTER_AUTH_SECRET: 'test-only-secret-do-not-use-in-prod-00000000',
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./src/test/apply-migrations.ts'],
  },
});

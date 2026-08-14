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
          // Test-only binding so the setup file can apply migrations.
          bindings: { TEST_MIGRATIONS: migrations },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./src/test/apply-migrations.ts'],
  },
});

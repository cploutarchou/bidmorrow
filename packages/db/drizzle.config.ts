/**
 * drizzle-kit config — used ONLY to generate SQL from the schema
 * (`pnpm exec drizzle-kit generate`). The generated SQL is then reviewed and
 * copied into the repo-root `migrations/` directory in wrangler's flat
 * migration format; drizzle-kit never applies migrations itself.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './drizzle',
});

/**
 * Vitest setup file (wired in vitest.config.ts): applies all D1 migrations
 * from /migrations to the isolated per-test-file local database before tests
 * run, mirroring `wrangler d1 migrations apply` semantics.
 */
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

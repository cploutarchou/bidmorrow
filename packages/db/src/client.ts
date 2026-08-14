/**
 * Typed Drizzle D1 client — the single `Db` handle every repository function
 * takes as its first argument (docs/security.md C6 repository conventions).
 *
 * The composition root (`apps/worker`) calls `createDb(env.DB)` once per
 * request/cron invocation and threads the handle through; repositories never
 * construct their own client.
 */
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';

import * as schema from './schema';

/** Creates the schema-typed Drizzle client over a D1 binding. */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

/** The typed database handle passed to every repository function. */
export type Db = ReturnType<typeof createDb>;

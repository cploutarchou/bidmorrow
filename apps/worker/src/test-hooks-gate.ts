/**
 * Phase 12 stage A: the shared double-gate predicate for every E2E test-only
 * capability (the mailbox-capture auth-email provider in `auth-instance.ts`,
 * and the `/api/test/*` routes in `routes/test-hooks.ts`). Single source of
 * truth so both call sites can never drift apart.
 *
 * Both conditions are required: `APP_ENV` must be `local` or `test` (never
 * `staging`/`production`, per `wrangler.jsonc`'s per-environment `vars`),
 * AND `E2E_TEST_HOOKS` must be the exact string `'true'` (never set outside
 * a developer's own `.dev.vars` / this repo's worker vitest config).
 */
import type { Env } from './env';

export function isE2ETestHooksEnabled(env: Env): boolean {
  return (env.APP_ENV === 'local' || env.APP_ENV === 'test') && env.E2E_TEST_HOOKS === 'true';
}

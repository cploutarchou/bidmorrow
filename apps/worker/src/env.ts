/**
 * Worker bindings + Hono context variables shared across the composition
 * root, middleware, and route modules (Phase 4 stage A + B). Split out of
 * `index.ts` so middleware/route files can import the types without
 * creating a circular import back through the composition root.
 */
import type { AuthSession } from '@bidmorrow/auth';
import type { OrganizationId } from '@bidmorrow/domain';
import type { Logger } from '@bidmorrow/observability';
import type { OrganizationMemberRole } from '@bidmorrow/db';

/**
 * Worker bindings declared in wrangler.jsonc, plus the secrets/config vars
 * supplied via `wrangler secret put` (staging/production) or `.dev.vars`
 * (local dev — see apps/worker/.dev.vars.example; never committed).
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: string;
  APP_BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  /**
   * Comma-separated allowlist of INTERNAL_ADMIN emails (docs/security.md
   * C6). Never a wrangler.jsonc `vars` entry (those are committed,
   * non-secret config) — always `wrangler secret put` / `.dev.vars`.
   * Optional: undefined/empty means no admin surface is reachable.
   */
  ADMIN_EMAILS?: string;
  /**
   * Native Workers rate-limit binding (docs/security.md C7). Optional: some
   * test/runtime environments may not provision it — middleware must
   * tolerate its absence rather than fail closed or open silently (it logs
   * once and skips limiting).
   */
  API_RATE_LIMITER?: RateLimit;
}

export interface Variables {
  requestId: string;
  logger: Logger;
  /** Set by the session middleware; absent until it has run. */
  session?: AuthSession;
  /** Set by the organization-context middleware; absent until it has run. */
  organizationId?: OrganizationId;
  role?: OrganizationMemberRole;
}

export type AppBindings = { Bindings: Env; Variables: Variables };

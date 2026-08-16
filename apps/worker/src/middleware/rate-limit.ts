/**
 * Native Workers rate-limit binding middleware (Phase 4 stage B,
 * docs/security.md C7). Keys on client IP (`cf-connecting-ip`, falling
 * back to a constant when absent, e.g. local dev without Cloudflare's edge
 * in front) — never on any client-supplied identifier.
 *
 * One shared limiter binding covers every rate-limited route group
 * (`/api/org/*`, `/api/admin/*`, `/api/billing/*`, `/api/account/*`,
 * `POST /api/webhooks/stripe`), so a client IP has a single budget across
 * the whole API surface. The webhook route is the SEC-P9-02 closure: it is
 * unauthenticated, so limiting must happen before signature verification
 * spends CPU on attacker-supplied bodies; Stripe's own delivery volume for
 * this app is far below the limit, and Stripe retries on 429.
 *
 * The binding is OPTIONAL: some runtimes (verify per-environment before
 * relying on this in staging/production) may not provision
 * `API_RATE_LIMITER`. When absent, the middleware skips limiting rather
 * than failing closed (which would take the API down) or silently
 * pretending to limit — it logs once per isolate per route group so the
 * gap is visible in structured logs, not swallowed.
 */
import type { MiddlewareHandler } from 'hono';

import type { AppBindings } from '../env';

export function createIpRateLimit(routeGroup: string): MiddlewareHandler<AppBindings> {
  let missingBindingLogged = false;
  return async (c, next) => {
    const limiter = c.env.API_RATE_LIMITER;
    if (limiter === undefined) {
      if (!missingBindingLogged) {
        missingBindingLogged = true;
        c.get('logger').warn('API_RATE_LIMITER binding is not configured; skipping rate limiting', {
          route_group: routeGroup,
        });
      }
      await next();
      return;
    }
    const key = c.req.header('cf-connecting-ip') ?? 'unknown';
    const outcome = await limiter.limit({ key });
    if (!outcome.success) {
      // Same envelope shape as every other error response (404/413/500 all
      // carry request_id) so 429s are correlatable in support tickets too.
      return c.json({ error: 'rate_limited', request_id: c.get('requestId') }, 429);
    }
    await next();
  };
}

export const rateLimitOrgApi: MiddlewareHandler<AppBindings> = createIpRateLimit('/api/org/*');

/**
 * Session middleware (Phase 4 stage B, docs/security.md C6): resolves the
 * Better Auth session for the current request via
 * `auth.api.getSession({ headers })` (verified from installed
 * `better-auth/dist/api/routes/session.mjs` — `requireHeaders: true`,
 * returns `{ session, user } | null`) and stores it on `c.var.session`.
 * Protected route groups use `requireSession` and get a uniform 401 JSON
 * response when there is no session — no route ever trusts a
 * client-supplied user id instead.
 */
import type { MiddlewareHandler } from 'hono';

import { createRequestAuth } from '../auth-instance';
import type { AppBindings } from '../env';

export const requireSession: MiddlewareHandler<AppBindings> = async (c, next) => {
  const auth = createRequestAuth(c.env, c.get('logger'));
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session === null) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  c.set('session', session);
  await next();
};

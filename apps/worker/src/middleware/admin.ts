/**
 * INTERNAL_ADMIN gate (Phase 4 stage B, docs/security.md C6/C11): allows
 * access to `/api/admin/*` only when the session user's email is in the
 * `ADMIN_EMAILS` allowlist (comma-separated, case-insensitive, trimmed).
 *
 * Returns 404, not 401/403, for every non-admin caller (unauthenticated,
 * authenticated-but-not-listed) — the admin surface's existence is never
 * revealed to a caller who cannot use it (docs/security.md C11 least
 * privilege / no surface disclosure). This intentionally does NOT depend on
 * `requireSession` running first: it resolves the session itself so it can
 * apply the same 404 to every non-admin case uniformly.
 */
import type { MiddlewareHandler } from 'hono';

import { createRequestAuth } from '../auth-instance';
import type { AppBindings } from '../env';

function parseAllowlist(value: string | undefined): Set<string> {
  if (value === undefined || value.trim().length === 0) return new Set();
  return new Set(
    value
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

export const requireInternalAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  const allowlist = parseAllowlist(c.env.ADMIN_EMAILS);
  if (allowlist.size === 0) {
    return c.json({ error: 'not_found', request_id: c.get('requestId') }, 404);
  }
  const auth = createRequestAuth(c.env, c.get('logger'));
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session === null || !allowlist.has(session.user.email.toLowerCase())) {
    return c.json({ error: 'not_found', request_id: c.get('requestId') }, 404);
  }
  c.set('session', session);
  await next();
};

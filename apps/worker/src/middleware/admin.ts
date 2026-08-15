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
 *
 * Phase 10 stage A (SEC-P4-07): every request that clears the allowlist gate
 * writes an `audit_events` row — reads included, not just mutations. This is
 * intentionally cheap and generic ("an admin hit this route"); routes that
 * perform a specific mutation (suspend an org, flip a flag, trigger a
 * backfill) ADDITIONALLY write their own specific `audit_events` row with a
 * stable `action` verb and before/after summary — see routes/admin.ts. The
 * generic row here is what makes "did ANY admin touch ANY admin endpoint"
 * always answerable, even for routes that forget/never need a specific one.
 */
import type { MiddlewareHandler } from 'hono';
import { createDb, insertAuditEvent } from '@bidmorrow/db';

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

/** Bound so the audit row's `after_summary` never carries a raw querystring beyond a sane length. */
const MAX_SUMMARY_LEN = 200;

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

  // Written AFTER the handler runs so the audit row can carry the actual
  // response status — never blocks/aborts the response on an audit-write
  // failure path (an admin action must not become invisible AND
  // un-actionable at once, but a logging failure also must not itself 500
  // an otherwise-successful admin request; a thrown error here would still
  // surface via the app-level onError handler, which is the accepted
  // behavior — audit writes are never silently swallowed).
  const db = createDb(c.env.DB);
  const query = c.req.query();
  const querySummary = Object.keys(query).length > 0 ? JSON.stringify(query) : null;
  await insertAuditEvent(db, {
    actorType: 'admin',
    actorId: session.user.id,
    organizationId: null,
    action: 'admin.request',
    targetType: 'http_request',
    targetId: `${c.req.method} ${c.req.path}`.slice(0, MAX_SUMMARY_LEN),
    beforeSummary: querySummary === null ? null : querySummary.slice(0, MAX_SUMMARY_LEN),
    afterSummary: `status=${c.res.status}`,
    occurredAt: Date.now(),
  });
};

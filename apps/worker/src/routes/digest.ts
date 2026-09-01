/**
 * Digest unsubscribe — the one route besides the Paddle webhook that is
 * deliberately reachable without a session (F-08,
 * PRODUCTION_READINESS_AUDIT.md).
 *
 * Authorization is the signed token itself
 * (`@bidmorrow/notifications/unsubscribe-token`), not a cookie: the whole
 * point is that a recipient who cannot or will not log in can still stop
 * the mail, and RFC 8058 one-click unsubscribe requires an endpoint a
 * mailbox provider can POST to with no user credentials at all.
 *
 * GET renders a confirmation page and changes NOTHING. Mailbox scanners,
 * link-preview bots and corporate security gateways follow links in mail
 * eagerly; a GET that unsubscribed would silently turn off digests nobody
 * asked to stop. The mutation is POST-only, which is also exactly what
 * RFC 8058 specifies (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`),
 * so the same endpoint serves both the human clicking through and the
 * provider's one-click button.
 *
 * Rate-limited before any HMAC work, like the webhook route (SEC-P9-02):
 * the endpoint is unauthenticated, so token verification must not spend CPU
 * on attacker-supplied input without a budget.
 */
import { Hono } from 'hono';

import {
  createDb,
  getDigestPreferences,
  insertAuditEvent,
  upsertDigestPreferences,
} from '@bidmorrow/db';
import type { DigestMinClassification } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';
import { escapeHtml, verifyUnsubscribeToken } from '@bidmorrow/notifications';

import type { AppBindings } from '../env';
import { createIpRateLimit } from '../middleware/rate-limit';

export const digestRoutes = new Hono<AppBindings>();

digestRoutes.use('/unsubscribe', createIpRateLimit('digest-unsubscribe'));

/**
 * Minimal, self-contained HTML. No inline styles and no scripts: the
 * Worker's CSP is `style-src 'self'` (plus Paddle's CDNs) and
 * `script-src 'self'`, and this page is served from the Worker rather than
 * the SPA, so it has no stylesheet of its own to link. Semantic markup
 * degrades to something perfectly readable unstyled, which is the right
 * trade for a page someone sees once.
 */
function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} | BidMorrow</title>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${bodyHtml}
</main>
</body>
</html>`;
}

function htmlResponse(body: string, status: 200 | 400): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * One generic rejection for every bad token — forged, corrupt, truncated by
 * a mail client, or signed with a rotated secret. Never distinguishes them:
 * the difference is only useful to someone probing the endpoint, and a
 * recipient's next step is the same in all four cases.
 */
const INVALID_BODY = `<p>This unsubscribe link is not valid. It may have been altered or
truncated by your email client.</p>
<p>You can still turn the digest off from your account settings, or reply to any
digest email and we will do it for you.</p>`;

digestRoutes.get('/unsubscribe', async (c) => {
  const token = c.req.query('token') ?? '';
  const payload = await verifyUnsubscribeToken(c.env.BETTER_AUTH_SECRET, token);
  if (payload === null) {
    return htmlResponse(page('Unsubscribe link not valid', INVALID_BODY), 400);
  }
  // Confirmation only — the POST below is what actually disables anything.
  return htmlResponse(
    page(
      'Turn off the daily digest?',
      `<p>This stops the BidMorrow daily digest for
<strong>${escapeHtml(payload.email)}</strong>.</p>
<form method="post" action="/api/digest/unsubscribe?token=${escapeHtml(encodeURIComponent(token))}">
<button type="submit">Turn off the daily digest</button>
</form>
<p>Digest settings belong to your whole workspace, so this turns the daily
digest off for the organization this address belongs to. You can turn it back
on any time from Settings.</p>`,
    ),
    200,
  );
});

digestRoutes.post('/unsubscribe', async (c) => {
  const token = c.req.query('token') ?? '';
  const payload = await verifyUnsubscribeToken(c.env.BETTER_AUTH_SECRET, token);
  if (payload === null) {
    return htmlResponse(page('Unsubscribe link not valid', INVALID_BODY), 400);
  }

  const db = createDb(c.env.DB);
  const organizationId = payload.organizationId as OrganizationId;
  const existing = await getDigestPreferences(db, organizationId);

  // Idempotent by construction: a second one-click (providers may retry, and
  // people click twice) finds `enabled` already false and still answers 200.
  // A missing preferences row means the org never enabled a digest — there
  // is nothing to turn off, and reporting failure would be both untrue and
  // useless to the recipient.
  if (existing !== null && existing.enabled === 1) {
    await upsertDigestPreferences(db, organizationId, {
      enabled: false,
      sendEmpty: existing.sendEmpty === 1,
      minClassification: existing.minClassification as DigestMinClassification,
      timezone: existing.timezone,
    });
    await insertAuditEvent(db, {
      // 'system', not 'user': the token proves possession of a message we
      // sent to that address, not the identity of a signed-in user, and
      // there is no session to take a `users.id` from.
      //
      // The recipient address is DELIBERATELY NOT recorded here (SEC-UNSUB-01).
      // An earlier version of this call wrote it into `afterSummary` on the
      // reasoning that `email_deliveries` already stores it, so it was no new
      // PII. That reasoning was wrong, and the retention rules are why:
      // `email_deliveries` is age-purged at 12 months AND purged when an
      // organization is purged, whereas `audit_events` is an append-only
      // ledger kept for 24 months that deliberately SURVIVES org purge and
      // tombstoning (see `tombstoneOrganization`). Writing the address here
      // would have made this row the longest-lived copy of it in the system
      // and would have kept it past the very erasure tombstoning exists to
      // perform. Correlation is still possible while it matters: the
      // `email_deliveries` row for this digest carries the address, and
      // `occurredAt` pins the event to it.
      actorType: 'system',
      organizationId,
      action: 'digest.unsubscribed',
      targetType: 'digest_preferences',
      targetId: existing.id,
      beforeSummary: 'enabled',
      afterSummary: 'disabled via a signed unsubscribe link (no session)',
      occurredAt: Date.now(),
    });
    c.get('logger').info('digest.unsubscribed', { organization_id: organizationId });
  }

  return htmlResponse(
    page(
      'Daily digest turned off',
      `<p>We have stopped the BidMorrow daily digest for
<strong>${escapeHtml(payload.email)}</strong>.</p>
<p>Account emails (sign-in, password resets and billing) still work as
normal; this only affects the daily digest. You can turn it back on any time
from Settings.</p>`,
    ),
    200,
  );
});

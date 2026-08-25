/**
 * `POST /api/webhooks/paddle` — the only unauthenticated (no session, no
 * org context) route in this Worker's `/api/*` surface: Paddle itself is
 * the caller, authenticated by its own signed payload instead of a
 * session cookie. Deliberately NOT under `/api/org` or any
 * `requireSession`/`requireOrganization` chain.
 *
 * Signature verification is mandatory and happens BEFORE anything else
 * touches the payload (`verifyPaddleWebhook`: HMAC-SHA256 over
 * `ts:rawBody` with the notification destination's secret, Web Crypto,
 * docs/security.md C9). The raw body is read via `c.req.text()` exactly
 * once, before any JSON parsing — the global `/api/*` `bodyLimit`
 * middleware only caps size while streaming through; it never consumes
 * the body itself.
 *
 * Responses: 400 with NO detail on a missing/invalid signature (never echo
 * the verification reason — it could leak timing/format information to
 * someone probing the endpoint); 200 on success OR a duplicate/ignored
 * event (Paddle must not retry those); 500 on a genuine processing failure
 * AFTER the event was recorded (Paddle retries the same event_id — safe,
 * because `processPaddleEvent` re-fetches current state rather than
 * trusting anything about the failed attempt).
 */
import { Hono } from 'hono';
import { processPaddleEvent, verifyPaddleWebhook } from '@bidmorrow/billing';
import { createDb } from '@bidmorrow/db';

import { resolveBillingConfig } from '../billing';
import type { AppBindings } from '../env';
import { createIpRateLimit } from '../middleware/rate-limit';

export const webhookRoutes = new Hono<AppBindings>();

// SEC-P9-02: throttle the unauthenticated webhook endpoint BEFORE signature
// verification spends CPU on attacker-supplied bodies. Keyed per client IP;
// Paddle's real delivery volume for this app is far below the limit, and
// Paddle retries deliveries that hit a 429.
webhookRoutes.use('*', createIpRateLimit('/api/webhooks/paddle'));

webhookRoutes.post('/paddle', async (c) => {
  const config = resolveBillingConfig(c.env);
  if (config === null) {
    c.get('logger').error('billing.webhook.not_configured', {});
    return c.json({ error: 'not_configured' }, 503);
  }

  const signature = c.req.header('paddle-signature');
  const rawBody = await c.req.text();
  if (signature === undefined) {
    return c.json({ error: 'invalid_signature' }, 400);
  }

  let event;
  try {
    event = await verifyPaddleWebhook(rawBody, signature, config.webhookSecret);
  } catch {
    // Never leak the verification reason.
    c.get('logger').warn('billing.webhook.invalid_signature', {});
    return c.json({ error: 'invalid_signature' }, 400);
  }

  const db = createDb(c.env.DB);
  const logger = c.get('logger').child({ billing_event_id: event.event_id });
  try {
    const outcome = await processPaddleEvent(
      {
        db,
        paddle: config.paddle,
        priceIds: config.priceIds,
        provenanceSecret: config.webhookSecret,
        logger,
      },
      event,
    );
    logger.info('billing.webhook.processed', { type: event.event_type, outcome });
  } catch (cause) {
    logger.error('billing.webhook.processing_failed', {
      type: event.event_type,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return c.json({ error: 'processing_failed' }, 500);
  }

  return c.json({ received: true }, 200);
});

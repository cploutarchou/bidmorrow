/**
 * `POST /api/webhooks/stripe` — the only unauthenticated (no session, no
 * org context) route in this Worker's `/api/*` surface: Stripe itself is
 * the caller, authenticated by its own signed payload instead of a
 * session cookie. Deliberately NOT under `/api/org` or any
 * `requireSession`/`requireOrganization` chain.
 *
 * Signature verification is mandatory and happens BEFORE anything else
 * touches the payload (`verifyStripeWebhookEvent`,
 * `stripe.webhooks.constructEventAsync` — Workers-compatible async
 * verification, docs/dependency-versions.md). The raw body is read via
 * `c.req.text()` exactly once, before any JSON parsing — there is no JSON
 * parsing in this handler at all, so the global `/api/*` `bodyLimit`
 * middleware (`index.ts`, registered ahead of every route mount) never
 * conflicts with it: `bodyLimit` only caps size while streaming through,
 * it does not consume the body itself.
 *
 * Responses: 400 with NO detail on a missing/invalid signature (never echo
 * Stripe's own verification error back to the caller — it could leak
 * timing/format information useful to an attacker probing the endpoint);
 * 200 on success OR a duplicate/ignored event (Stripe must not retry
 * those); 500 on a genuine processing failure AFTER the event was recorded
 * (Stripe retries — safe, because `processStripeEvent` re-fetches current
 * state rather than trusting anything about the failed attempt).
 */
import { Hono } from 'hono';
import { processStripeEvent, verifyStripeWebhookEvent } from '@bidmorrow/billing';
import { createDb } from '@bidmorrow/db';

import { resolveBillingConfig } from '../billing';
import type { AppBindings } from '../env';

export const webhookRoutes = new Hono<AppBindings>();

webhookRoutes.post('/stripe', async (c) => {
  const config = resolveBillingConfig(c.env);
  const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET;
  if (config === null || webhookSecret === undefined) {
    c.get('logger').error('billing.webhook.not_configured', {});
    return c.json({ error: 'not_configured' }, 503);
  }

  const signature = c.req.header('stripe-signature');
  const rawBody = await c.req.text();
  if (signature === undefined) {
    return c.json({ error: 'invalid_signature' }, 400);
  }

  let event;
  try {
    event = await verifyStripeWebhookEvent(config.stripe, rawBody, signature, webhookSecret);
  } catch {
    // Never leak the verification error's own message/detail.
    c.get('logger').warn('billing.webhook.invalid_signature', {});
    return c.json({ error: 'invalid_signature' }, 400);
  }

  const db = createDb(c.env.DB);
  const logger = c.get('logger').child({ billing_event_id: event.id });
  try {
    const outcome = await processStripeEvent(
      { db, stripe: config.stripe, priceIds: config.priceIds, logger },
      event,
    );
    logger.info('billing.webhook.processed', { type: event.type, outcome });
  } catch (cause) {
    logger.error('billing.webhook.processing_failed', {
      type: event.type,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return c.json({ error: 'processing_failed' }, 500);
  }

  return c.json({ received: true }, 200);
});

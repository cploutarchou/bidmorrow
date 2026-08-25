/**
 * `/api/billing/*` — checkout, customer portal, invoices and status
 * (ADR-0011: Paddle Billing). Every handler reads `organizationId`/`role`/
 * `session` from `c.var` (set by session/organization-context middleware —
 * never from client input), per docs/security.md C6. Paddle-hosted
 * checkout overlay and customer portal only — no card data ever reaches
 * this Worker.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutTransaction,
  createPortalSession,
  FoundingPlanUnavailableError,
  getEntitlement,
  getInvoicePdfForOrganization,
  isFoundingPlanAvailable,
  listInvoicesForOrganization,
  NoBillingCustomerError,
  paymentStateFromStatus,
  planPrice,
  reactivateSubscription,
  SubscriptionAlreadyExistsError,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '@bidmorrow/billing';
import { createDb, getSubscription, insertAuditEvent, insertProductEvent } from '@bidmorrow/db';
import { readPrelaunchState } from '../prelaunch';

import { resolveBillingConfig } from '../billing';
import type { AppBindings } from '../env';
import { requireOrganization, requireRole } from '../middleware/organization';
import { rateLimitOrgApi } from '../middleware/rate-limit';
import { requireSession } from '../middleware/session';

const checkoutSchema = z.object({ plan: z.enum(['founding', 'standard']) }).strict();
const cancelSchema = z.object({ confirm: z.literal('CANCEL_SUBSCRIPTION') }).strict();
/** Paddle transaction ids: `txn_` + 26 lowercase base32 chars (API reference). */
const transactionIdSchema = z.object({ transactionId: z.string().regex(/^txn_[a-z0-9]{26}$/) });

export const billingRoutes = new Hono<AppBindings>();

billingRoutes.use('*', rateLimitOrgApi);
billingRoutes.use('*', requireSession);
billingRoutes.use('*', requireOrganization);

billingRoutes.post(
  '/checkout',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', checkoutSchema),
  async (c) => {
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const config = resolveBillingConfig(c.env);
    if (config === null) {
      c.get('logger').error('billing.checkout.not_configured', {});
      return c.json({ error: 'not_configured' }, 503);
    }
    const db = createDb(c.env.DB);
    // Pre-launch gate (prelaunch.ts): NEW subscriptions are closed while
    // pre-launch is active. Portal/cancel/existing-subscription flows are
    // deliberately NOT gated — only starting a new checkout is.
    const { prelaunch } = await readPrelaunchState(db, c.env.APP_ENV);
    if (prelaunch) {
      return c.json(
        { error: 'subscriptions_closed', message: 'Subscriptions open at launch.' },
        403,
      );
    }
    const { plan } = c.req.valid('json');
    let result;
    try {
      result = await createCheckoutTransaction(
        { db, paddle: config.paddle, priceIds: config.priceIds },
        { organizationId, plan },
      );
    } catch (cause) {
      if (cause instanceof SubscriptionAlreadyExistsError) {
        return c.json({ error: 'subscription_exists' }, 409);
      }
      if (cause instanceof FoundingPlanUnavailableError) {
        return c.json({ error: 'founding_unavailable', reason: cause.reason }, 409);
      }
      throw cause;
    }
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: session.user.id,
      organizationId,
      action: 'billing.checkout_started',
      targetType: 'subscription',
      targetId: null,
      afterSummary: `plan=${plan} transaction=${result.transactionId}`,
      occurredAt: Date.now(),
    });
    await insertProductEvent(db, {
      organizationId,
      userId: session.user.id,
      name: 'checkout_started',
      propertiesJson: JSON.stringify({ plan }),
    });
    // The SPA opens the Paddle.js overlay for this transaction. The
    // session email is a prefill convenience only — Paddle collects and
    // verifies the billing email itself.
    return c.json(
      {
        transactionId: result.transactionId,
        customerEmail: session.user.email,
        successPath: '/app/billing/success',
      },
      200,
    );
  },
);

billingRoutes.post('/portal', requireRole('ORGANIZATION_OWNER'), async (c) => {
  const organizationId = c.get('organizationId');
  const session = c.get('session');
  if (organizationId === undefined || session === undefined) {
    return c.json({ error: 'no_organization' }, 403);
  }
  const config = resolveBillingConfig(c.env);
  if (config === null) {
    c.get('logger').error('billing.portal.not_configured', {});
    return c.json({ error: 'not_configured' }, 503);
  }
  const db = createDb(c.env.DB);
  let result;
  try {
    result = await createPortalSession({ db, paddle: config.paddle }, { organizationId });
  } catch (cause) {
    if (cause instanceof NoBillingCustomerError) {
      return c.json({ error: 'no_billing_customer' }, 404);
    }
    throw cause;
  }
  await insertAuditEvent(db, {
    actorType: 'user',
    actorId: session.user.id,
    organizationId,
    action: 'billing.portal_opened',
    targetType: 'subscription',
    targetId: null,
    occurredAt: Date.now(),
  });
  return c.json({ url: result.url }, 200);
});

billingRoutes.get('/invoices', requireRole('ORGANIZATION_OWNER'), async (c) => {
  const organizationId = c.get('organizationId');
  const session = c.get('session');
  if (organizationId === undefined || session === undefined) {
    return c.json({ error: 'no_organization' }, 403);
  }
  const config = resolveBillingConfig(c.env);
  if (config === null) {
    c.get('logger').error('billing.invoices.not_configured', {});
    return c.json({ error: 'not_configured' }, 503);
  }
  const db = createDb(c.env.DB);
  let result;
  try {
    result = await listInvoicesForOrganization({ db, paddle: config.paddle }, { organizationId });
  } catch (cause) {
    // Never leak provider internals (error message/type/request id) to the
    // client — logged server-side only, matching webhook.ts's "signature
    // errors never echoed back" posture for the same reason.
    c.get('logger').error('billing.invoices.provider_error', {
      organizationId,
      cause: cause instanceof Error ? cause.message : 'unknown',
    });
    return c.json({ error: 'billing_provider_error' }, 502);
  }
  await insertAuditEvent(db, {
    actorType: 'user',
    actorId: session.user.id,
    organizationId,
    action: 'billing.invoices_viewed',
    targetType: 'subscription',
    targetId: null,
    occurredAt: Date.now(),
  });
  return c.json({ invoices: result.invoices, hasBillingCustomer: result.hasBillingCustomer }, 200);
});

/**
 * Resolves the Paddle-hosted PDF for ONE invoice on demand. The transaction
 * id is client-supplied, so ownership is re-proved server-side against the
 * org's own customer id (`getInvoicePdfForOrganization`); a foreign or
 * unknown id is a plain 404. Returns JSON (`{ url }`) rather than a 302 so
 * the endpoint can never act as an open redirect.
 */
billingRoutes.get(
  '/invoices/:transactionId/pdf',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('param', transactionIdSchema),
  async (c) => {
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const config = resolveBillingConfig(c.env);
    if (config === null) {
      c.get('logger').error('billing.invoice_pdf.not_configured', {});
      return c.json({ error: 'not_configured' }, 503);
    }
    const db = createDb(c.env.DB);
    const { transactionId } = c.req.valid('param');
    let outcome;
    try {
      outcome = await getInvoicePdfForOrganization(
        { db, paddle: config.paddle },
        { organizationId, transactionId },
      );
    } catch (cause) {
      if (cause instanceof NoBillingCustomerError) {
        return c.json({ error: 'not_found' }, 404);
      }
      c.get('logger').error('billing.invoice_pdf.provider_error', {
        organizationId,
        cause: cause instanceof Error ? cause.message : 'unknown',
      });
      return c.json({ error: 'billing_provider_error' }, 502);
    }
    if (outcome.kind === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (outcome.kind === 'no_invoice') return c.json({ error: 'no_invoice' }, 404);
    return c.json({ url: outcome.url }, 200);
  },
);

billingRoutes.post(
  '/cancel',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', cancelSchema),
  async (c) => {
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const config = resolveBillingConfig(c.env);
    if (config === null) {
      c.get('logger').error('billing.cancel.not_configured', {});
      return c.json({ error: 'not_configured' }, 503);
    }
    const db = createDb(c.env.DB);
    const outcome = await cancelSubscriptionAtPeriodEnd(
      { db, paddle: config.paddle },
      { organizationId },
    );
    switch (outcome.kind) {
      case 'no_subscription':
        return c.json({ error: 'no_subscription' }, 409);
      case 'already_canceled':
        return c.json({ error: 'already_canceled' }, 409);
      case 'already_scheduled':
        // Idempotent: no state change, so no audit row/product event either
        // — a repeat request/double-click is a genuine no-op, not a new
        // cancellation action.
        return c.json(
          {
            cancelAtPeriodEnd: true,
            currentPeriodEndAt: outcome.currentPeriodEndAt,
            effective: 'period_end',
          },
          200,
        );
      case 'canceled_at_period_end':
        await insertAuditEvent(db, {
          actorType: 'user',
          actorId: session.user.id,
          organizationId,
          action: 'billing.subscription_cancel_scheduled',
          targetType: 'subscription',
          targetId: null,
          afterSummary: `billingSubscriptionId=${outcome.billingSubscriptionId}`,
          occurredAt: Date.now(),
        });
        return c.json(
          {
            cancelAtPeriodEnd: true,
            currentPeriodEndAt: outcome.currentPeriodEndAt,
            effective: 'period_end',
          },
          200,
        );
    }
  },
);

billingRoutes.post('/reactivate', requireRole('ORGANIZATION_OWNER'), async (c) => {
  const organizationId = c.get('organizationId');
  const session = c.get('session');
  if (organizationId === undefined || session === undefined) {
    return c.json({ error: 'no_organization' }, 403);
  }
  const config = resolveBillingConfig(c.env);
  if (config === null) {
    c.get('logger').error('billing.reactivate.not_configured', {});
    return c.json({ error: 'not_configured' }, 503);
  }
  const db = createDb(c.env.DB);
  const outcome = await reactivateSubscription({ db, paddle: config.paddle }, { organizationId });
  switch (outcome.kind) {
    case 'no_subscription':
      return c.json({ error: 'no_subscription', requiresCheckout: true }, 409);
    case 'already_canceled':
      return c.json({ error: 'already_canceled', requiresCheckout: true }, 409);
    case 'not_scheduled':
      return c.json({ error: 'not_scheduled' }, 409);
    case 'reactivated':
      await insertAuditEvent(db, {
        actorType: 'user',
        actorId: session.user.id,
        organizationId,
        action: 'billing.subscription_reactivated',
        targetType: 'subscription',
        targetId: null,
        afterSummary: `billingSubscriptionId=${outcome.billingSubscriptionId}`,
        occurredAt: Date.now(),
      });
      return c.json(
        {
          cancelAtPeriodEnd: false,
          status: outcome.status,
          currentPeriodEndAt: outcome.currentPeriodEndAt,
        },
        200,
      );
  }
});

billingRoutes.get('/status', async (c) => {
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
  const db = createDb(c.env.DB);
  const [entitlement, subscription, foundingAvailable] = await Promise.all([
    getEntitlement(db, organizationId),
    getSubscription(db, organizationId),
    isFoundingPlanAvailable(db),
  ]);
  return c.json({
    entitlement,
    subscription:
      subscription === null
        ? null
        : {
            plan: subscription.plan,
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === 1,
            currentPeriodEndAt: subscription.currentPeriodEndAt,
            price: planPrice(subscription.plan as SubscriptionPlan),
            paymentState: paymentStateFromStatus(subscription.status as SubscriptionStatus),
          },
    foundingAvailable,
  });
});

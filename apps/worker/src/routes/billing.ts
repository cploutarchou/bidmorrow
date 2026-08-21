/**
 * `/api/billing/*` — Checkout, Customer Portal, and status (Phase 9).
 * Every handler reads `organizationId`/`role`/`session` from `c.var` (set
 * by session/organization-context middleware — never from client input),
 * per docs/security.md C6. Stripe-hosted Checkout and Customer Portal
 * only — no card data ever reaches this Worker.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutSession,
  createPortalSession,
  FoundingPlanUnavailableError,
  getEntitlement,
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
      result = await createCheckoutSession(
        { db, stripe: config.stripe, priceIds: config.priceIds, appBaseUrl: config.appBaseUrl },
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
      afterSummary: `plan=${plan}`,
      occurredAt: Date.now(),
    });
    await insertProductEvent(db, {
      organizationId,
      userId: session.user.id,
      name: 'checkout_started',
      propertiesJson: JSON.stringify({ plan }),
    });
    return c.json({ url: result.url }, 200);
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
    result = await createPortalSession(
      { db, stripe: config.stripe, appBaseUrl: config.appBaseUrl },
      { organizationId },
    );
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
    result = await listInvoicesForOrganization({ db, stripe: config.stripe }, { organizationId });
  } catch (cause) {
    // Never leak Stripe internals (error message/type/request id) to the
    // client — logged server-side only, matching webhook.ts's "signature
    // errors never echoed back" posture for the same reason.
    c.get('logger').error('billing.invoices.stripe_error', {
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
      { db, stripe: config.stripe },
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
          afterSummary: `stripeSubscriptionId=${outcome.stripeSubscriptionId}`,
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
  const outcome = await reactivateSubscription({ db, stripe: config.stripe }, { organizationId });
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
        afterSummary: `stripeSubscriptionId=${outcome.stripeSubscriptionId}`,
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

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
  createCheckoutSession,
  createPortalSession,
  FoundingPlanUnavailableError,
  getEntitlement,
  isFoundingPlanAvailable,
  NoBillingCustomerError,
  SubscriptionAlreadyExistsError,
} from '@bidmorrow/billing';
import { createDb, getSubscription, insertAuditEvent, insertProductEvent } from '@bidmorrow/db';

import { resolveBillingConfig } from '../billing';
import type { AppBindings } from '../env';
import { requireOrganization, requireRole } from '../middleware/organization';
import { rateLimitOrgApi } from '../middleware/rate-limit';
import { requireSession } from '../middleware/session';

const checkoutSchema = z.object({ plan: z.enum(['founding', 'standard']) }).strict();

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
          },
    foundingAvailable,
  });
});

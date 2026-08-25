/**
 * Paddle-hosted customer portal session
 * (`POST /customers/{id}/portal-sessions` → `urls.general.overview`,
 * Paddle API reference 2026-08-25). Links are temporary and must not be
 * cached — a fresh session is created on every click. The portal handles
 * payment-method updates, invoices and cancellation; no card data ever
 * touches our code.
 */
import { getSubscription, type Db } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';

import { NoBillingCustomerError } from './errors';
import type { PortalSessionsClient } from './paddle-client';

export interface PortalDeps {
  readonly db: Db;
  readonly paddle: { readonly customers: { readonly portalSessions: PortalSessionsClient } };
}

export interface CreatePortalSessionArgs {
  readonly organizationId: OrganizationId;
}

export interface PortalSessionResult {
  readonly url: string;
}

/**
 * Requires an existing `billing_customer_id` (set by a prior checkout).
 * Throws {@link NoBillingCustomerError} (404 at the route layer) rather
 * than silently creating one — the portal has nothing to manage before a
 * customer exists.
 */
export async function createPortalSession(
  deps: PortalDeps,
  args: CreatePortalSessionArgs,
): Promise<PortalSessionResult> {
  const subscription = await getSubscription(deps.db, args.organizationId);
  if (subscription === null) {
    throw new NoBillingCustomerError(args.organizationId);
  }
  const session = await deps.paddle.customers.portalSessions.create(
    subscription.billingCustomerId,
    subscription.billingSubscriptionId !== null
      ? { subscription_ids: [subscription.billingSubscriptionId] }
      : {},
  );
  const url = session.urls.general.overview;
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('createPortalSession: Paddle returned no https portal url');
  }
  return { url };
}

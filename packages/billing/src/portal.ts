/**
 * Stripe-hosted Customer Portal session creation
 * (`billingPortal.sessions.create`, verified from the installed SDK's
 * `esm/resources/BillingPortal/Sessions.d.ts` — `customer`/`return_url`
 * params, response carries `url: string`). No card data ever touches our
 * code.
 */
import { getSubscription, type Db } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';

import { NoBillingCustomerError } from './errors';
import type { CheckoutStripeClient } from './stripe-types';

export interface PortalDeps {
  readonly db: Db;
  readonly stripe: Pick<CheckoutStripeClient, 'billingPortal'>;
  readonly appBaseUrl: string;
}

export interface CreatePortalSessionArgs {
  readonly organizationId: OrganizationId;
}

export interface PortalSessionResult {
  readonly url: string;
}

/**
 * Requires an existing `stripe_customer_id` (set by a prior checkout).
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
  const session = await deps.stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${deps.appBaseUrl}/app/settings`,
  });
  return { url: session.url };
}

/**
 * User-initiated reactivation of a subscription still within its scheduled
 * cancel-at-period-end window (`POST /api/billing/reactivate`,
 * ORGANIZATION_OWNER only, route layer). Reverses the same
 * `subscriptions.update(id, { cancel_at_period_end: false })` toggle
 * `cancellation.ts` sets to `true` — see that file's header for the SDK
 * citation (`SubscriptionUpdateParams.cancel_at_period_end?: boolean`,
 * "Defaults to `false`") and `applySubscriptionCancelAtPeriodEnd`, reused
 * here unchanged (only the boolean differs).
 *
 * Only reverses a PENDING cancellation — a subscription whose current
 * period has already elapsed and moved to Stripe's `canceled` status cannot
 * be reactivated via this toggle (Stripe itself would reject an update to a
 * fully-canceled subscription); that case is reported back as
 * `already_canceled` so the route can point the owner at a new Checkout
 * session instead (checkout.ts's own reactivation-via-Checkout path reuses
 * the existing `stripe_customer_id`, so nothing is lost by going through
 * Checkout again).
 */
import { getSubscription, type SubscriptionStatus } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';

import { applySubscriptionCancelAtPeriodEnd, type CancelSubscriptionDeps } from './cancellation';

export type ReactivateSubscriptionDeps = CancelSubscriptionDeps;

export type ReactivateSubscriptionOutcome =
  /** No subscription row for this org — nothing to reactivate; route to Checkout. */
  | { readonly kind: 'no_subscription' }
  /** Fully canceled (Stripe already ended the subscription) — route to Checkout. */
  | { readonly kind: 'already_canceled' }
  /**
   * Not currently scheduled to cancel (`cancelAtPeriodEnd` is `0`), or in a
   * status this toggle does not apply to (`past_due`/`unpaid`) — nothing to
   * reverse. Distinct from `already_canceled` because the subscription is
   * still live; the route surfaces this without the "go to Checkout" flag.
   */
  | { readonly kind: 'not_scheduled' }
  /** Stripe API call succeeded; local row updated to reflect `cancel_at_period_end: false`. */
  | {
      readonly kind: 'reactivated';
      readonly stripeSubscriptionId: string;
      readonly status: SubscriptionStatus;
      readonly currentPeriodEndAt: number | null;
    };

export async function reactivateSubscription(
  deps: ReactivateSubscriptionDeps,
  args: { organizationId: OrganizationId },
): Promise<ReactivateSubscriptionOutcome> {
  const subscription = await getSubscription(deps.db, args.organizationId);
  if (subscription === null || subscription.stripeSubscriptionId === null) {
    return { kind: 'no_subscription' };
  }
  if (subscription.status === 'canceled') {
    return { kind: 'already_canceled' };
  }
  const eligibleStatus = subscription.status === 'active' || subscription.status === 'trialing';
  if (subscription.cancelAtPeriodEnd !== 1 || !eligibleStatus) {
    return { kind: 'not_scheduled' };
  }

  const updated = await applySubscriptionCancelAtPeriodEnd(
    deps,
    args.organizationId,
    subscription,
    subscription.stripeSubscriptionId,
    false,
  );

  return {
    kind: 'reactivated',
    stripeSubscriptionId: updated.id,
    status: subscription.status as SubscriptionStatus,
    currentPeriodEndAt: subscription.currentPeriodEndAt,
  };
}

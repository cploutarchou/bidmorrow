/**
 * User-initiated reactivation of a subscription still within its scheduled
 * cancel window (`POST /api/billing/reactivate`, ORGANIZATION_OWNER only,
 * route layer). `PATCH /subscriptions/{id} { scheduled_change: null }` is
 * Paddle's documented way to remove a pending change (API reference
 * 2026-08-25: "When updating, you may only set to `null` to remove a
 * scheduled change").
 *
 * Only reverses a PENDING cancellation — a subscription whose period has
 * already elapsed and moved to `canceled` cannot be reinstated (Paddle:
 * "You can't reinstate a canceled subscription"); that case is reported as
 * `already_canceled` so the route can point the owner at a new checkout,
 * which reuses the existing customer id (see checkout.ts).
 */
import { getSubscription, type SubscriptionStatus } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';

import { mirrorLiveSubscription, type CancelSubscriptionDeps } from './cancellation';
import { paddleTimestampToMillis } from './paddle-client';
import { mapPaddleSubscriptionStatus } from './plans';

export type ReactivateSubscriptionDeps = CancelSubscriptionDeps;

export type ReactivateSubscriptionOutcome =
  /** No subscription row for this org — nothing to reactivate; route to checkout. */
  | { readonly kind: 'no_subscription' }
  /** Fully canceled — route to checkout. */
  | { readonly kind: 'already_canceled' }
  /** Not scheduled to cancel, or in a status the toggle does not apply to (`past_due`/`paused`). */
  | { readonly kind: 'not_scheduled' }
  /** Paddle API call succeeded; local row updated. */
  | {
      readonly kind: 'reactivated';
      readonly billingSubscriptionId: string;
      readonly status: SubscriptionStatus;
      readonly currentPeriodEndAt: number | null;
    };

export async function reactivateSubscription(
  deps: ReactivateSubscriptionDeps,
  args: { organizationId: OrganizationId },
): Promise<ReactivateSubscriptionOutcome> {
  const subscription = await getSubscription(deps.db, args.organizationId);
  if (subscription === null || subscription.billingSubscriptionId === null) {
    return { kind: 'no_subscription' };
  }
  if (subscription.status === 'canceled') {
    return { kind: 'already_canceled' };
  }
  const eligibleStatus = subscription.status === 'active' || subscription.status === 'trialing';
  if (subscription.cancelAtPeriodEnd !== 1 || !eligibleStatus) {
    return { kind: 'not_scheduled' };
  }

  const updated = await deps.paddle.subscriptions.update(subscription.billingSubscriptionId, {
    scheduled_change: null,
  });
  await mirrorLiveSubscription(deps.db, args.organizationId, subscription, updated);

  return {
    kind: 'reactivated',
    billingSubscriptionId: updated.id,
    status: mapPaddleSubscriptionStatus(updated.status),
    currentPeriodEndAt:
      paddleTimestampToMillis(updated.current_billing_period?.ends_at) ??
      subscription.currentPeriodEndAt,
  };
}

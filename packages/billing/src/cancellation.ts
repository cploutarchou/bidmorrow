/**
 * Organization-deletion Stripe cancellation (docs/privacy.md commitment 2,
 * Phase 11 stage A).
 *
 * `subscriptions.update(id, { cancel_at_period_end: true })` (verified from
 * the installed SDK's `esm/resources/Subscriptions.d.ts` —
 * `SubscriptionUpdateParams.cancel_at_period_end?: boolean`, response
 * carries the same shape as `retrieve`) is used rather than
 * `subscriptions.cancel` (immediate termination): an org that deletes
 * itself mid-billing-period keeps access to what it already paid for until
 * the period ends — matching Stripe Customer Portal's own default
 * cancellation behavior and avoiding an unearned mid-cycle refund
 * obligation. The org is already fully locked out of the product by the
 * soft-delete (`organizations.status = 'deleted'`) regardless of Stripe
 * subscription status, so "still billable until period end" has no product
 * access consequence.
 */
import {
  getSubscription,
  upsertSubscriptionByStripeCustomerId,
  type Db,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';
import type Stripe from 'stripe';

export interface CancellationStripeClient {
  readonly subscriptions: {
    update(id: string, params: { cancel_at_period_end: boolean }): Promise<Stripe.Subscription>;
  };
}

export interface CancelSubscriptionDeps {
  readonly db: Db;
  readonly stripe: CancellationStripeClient;
}

export type CancelSubscriptionOutcome =
  /** No subscription row for this org — nothing to cancel. */
  | { readonly kind: 'no_subscription' }
  /** Already canceled — no-op, idempotent. */
  | { readonly kind: 'already_canceled' }
  /** Stripe API call succeeded; local row updated to reflect `cancel_at_period_end`. */
  | { readonly kind: 'canceled_at_period_end'; readonly stripeSubscriptionId: string };

/**
 * Best-effort cancellation for organization deletion. The caller (route
 * layer) decides what to do when Stripe is unreachable/errors — see
 * `routes/org.ts`'s `DELETE /` handler: it never blocks the deletion itself
 * on this call succeeding, and records an audit row either way so an unpaid
 * Stripe cancellation is never silently lost (manual follow-up path,
 * documented in docs/privacy.md).
 */
export async function cancelSubscriptionForOrgDeletion(
  deps: CancelSubscriptionDeps,
  args: { organizationId: OrganizationId },
): Promise<CancelSubscriptionOutcome> {
  const subscription = await getSubscription(deps.db, args.organizationId);
  if (subscription === null || subscription.stripeSubscriptionId === null) {
    return { kind: 'no_subscription' };
  }
  if (subscription.status === 'canceled') {
    return { kind: 'already_canceled' };
  }

  const updated = await deps.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  // Mirror the same live-Stripe-state write pattern webhook.ts uses (never
  // trust a payload's mutable fields blindly — but this update call's own
  // response IS the live state, since we just requested it).
  await upsertSubscriptionByStripeCustomerId(deps.db, args.organizationId, {
    stripeCustomerId: subscription.stripeCustomerId,
    stripeSubscriptionId: updated.id,
    // `status`/`plan` are plain `text` columns at the Drizzle type level —
    // their allowed values are enforced by DB CHECK constraints, not
    // Drizzle's type system (same cast pattern as `account.ts`'s
    // `membership.role` cast). We just read these back from the DB.
    status: subscription.status as SubscriptionStatus,
    plan: subscription.plan as SubscriptionPlan,
    currentPeriodEndAt: subscription.currentPeriodEndAt,
    cancelAtPeriodEnd: updated.cancel_at_period_end,
  });

  return { kind: 'canceled_at_period_end', stripeSubscriptionId: updated.id };
}

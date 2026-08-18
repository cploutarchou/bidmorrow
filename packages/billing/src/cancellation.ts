/**
 * Stripe `cancel_at_period_end` scheduling — shared by two callers:
 *
 * 1. Organization-deletion cancellation (docs/privacy.md commitment 2,
 *    Phase 11 stage A) — `cancelSubscriptionForOrgDeletion`.
 * 2. User-initiated cancellation from the client area
 *    (`POST /api/billing/cancel`, docs/product-scope.md) —
 *    `cancelSubscriptionAtPeriodEnd`.
 *
 * `subscriptions.update(id, { cancel_at_period_end: true })` (verified from
 * the installed SDK's `esm/resources/Subscriptions.d.ts` —
 * `SubscriptionUpdateParams.cancel_at_period_end?: boolean`, response
 * carries the same shape as `retrieve`) is used rather than
 * `subscriptions.cancel` (immediate termination): the org keeps access to
 * what it already paid for until the period ends — matching Stripe Customer
 * Portal's own default cancellation behavior and avoiding an unearned
 * mid-cycle refund obligation. (For the org-deletion path specifically, the
 * org is already fully locked out of the product by the soft-delete
 * regardless of Stripe subscription status, so "still billable until period
 * end" has no product access consequence there.)
 *
 * `reactivation.ts` reverses the same `cancel_at_period_end` toggle
 * (`false`) and reuses `SubscriptionCancelAtPeriodEndClient` from
 * `stripe-types.ts` for the identical Stripe client slice.
 */
import {
  getSubscription,
  upsertSubscriptionByStripeCustomerId,
  type Db,
  type Subscription,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';
import type Stripe from 'stripe';

import type { SubscriptionCancelAtPeriodEndClient } from './stripe-types';

/** @deprecated Use {@link SubscriptionCancelAtPeriodEndClient} (stripe-types.ts) — kept as an alias so existing imports of this name keep compiling. */
export type CancellationStripeClient = SubscriptionCancelAtPeriodEndClient;

export interface CancelSubscriptionDeps {
  readonly db: Db;
  readonly stripe: SubscriptionCancelAtPeriodEndClient;
}

export type CancelSubscriptionOutcome =
  /** No subscription row for this org — nothing to cancel. */
  | { readonly kind: 'no_subscription' }
  /** Already canceled — no-op, idempotent. */
  | { readonly kind: 'already_canceled' }
  /** Stripe API call succeeded; local row updated to reflect `cancel_at_period_end`. */
  | { readonly kind: 'canceled_at_period_end'; readonly stripeSubscriptionId: string };

/**
 * Calls `subscriptions.update` and mirrors the live response into the local
 * row (never trusting the pre-call `subscription` snapshot's mutable
 * fields except as the unchanged carry-forward values `status`/`plan`/
 * `currentPeriodEndAt` — those three are NOT what this call changes, so
 * reading them back off the row we already have is correct; only
 * `cancel_at_period_end` and the subscription id come from Stripe's
 * response). Shared by both `cancelSubscriptionForOrgDeletion` and
 * `cancelSubscriptionAtPeriodEnd` below, and by `reactivation.ts`'s
 * `reactivateSubscription` (same shape, opposite boolean).
 */
export async function applySubscriptionCancelAtPeriodEnd(
  deps: CancelSubscriptionDeps,
  organizationId: OrganizationId,
  subscription: Subscription,
  stripeSubscriptionId: string,
  cancelAtPeriodEnd: boolean,
): Promise<Stripe.Subscription> {
  const updated = await deps.stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: cancelAtPeriodEnd,
  });

  // Mirror the same live-Stripe-state write pattern webhook.ts uses (never
  // trust a payload's mutable fields blindly — but this update call's own
  // response IS the live state, since we just requested it).
  await upsertSubscriptionByStripeCustomerId(deps.db, organizationId, {
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

  return updated;
}

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

  const updated = await applySubscriptionCancelAtPeriodEnd(
    deps,
    args.organizationId,
    subscription,
    subscription.stripeSubscriptionId,
    true,
  );

  return { kind: 'canceled_at_period_end', stripeSubscriptionId: updated.id };
}

export type CancelSubscriptionAtPeriodEndOutcome =
  /** No subscription row for this org — nothing to cancel. */
  | { readonly kind: 'no_subscription' }
  /** Already fully canceled — nothing left to schedule. */
  | { readonly kind: 'already_canceled' }
  /**
   * Already scheduled to cancel at period end (a prior call, or the Stripe
   * Customer Portal, already set `cancel_at_period_end`) — idempotent
   * no-op, no Stripe call made, current state returned as-is.
   */
  | { readonly kind: 'already_scheduled'; readonly currentPeriodEndAt: number | null }
  /** Stripe API call succeeded; local row updated to reflect `cancel_at_period_end`. */
  | {
      readonly kind: 'canceled_at_period_end';
      readonly stripeSubscriptionId: string;
      readonly currentPeriodEndAt: number | null;
    };

/**
 * User-initiated cancel-at-period-end, called from `POST
 * /api/billing/cancel` (ORGANIZATION_OWNER only, route layer). NEVER an
 * immediate cancel — the org keeps access through the current paid period,
 * matching `cancelSubscriptionForOrgDeletion`'s and the Customer Portal's
 * own default behavior (see file header). Unlike the org-deletion path,
 * this checks `cancelAtPeriodEnd` first so a repeat click/request is a
 * genuine idempotent no-op instead of a redundant (harmless, but wasteful
 * and audit-noisy) Stripe API call.
 */
export async function cancelSubscriptionAtPeriodEnd(
  deps: CancelSubscriptionDeps,
  args: { organizationId: OrganizationId },
): Promise<CancelSubscriptionAtPeriodEndOutcome> {
  const subscription = await getSubscription(deps.db, args.organizationId);
  if (subscription === null || subscription.stripeSubscriptionId === null) {
    return { kind: 'no_subscription' };
  }
  if (subscription.status === 'canceled') {
    return { kind: 'already_canceled' };
  }
  if (subscription.cancelAtPeriodEnd === 1) {
    return { kind: 'already_scheduled', currentPeriodEndAt: subscription.currentPeriodEndAt };
  }

  const updated = await applySubscriptionCancelAtPeriodEnd(
    deps,
    args.organizationId,
    subscription,
    subscription.stripeSubscriptionId,
    true,
  );

  return {
    kind: 'canceled_at_period_end',
    stripeSubscriptionId: updated.id,
    currentPeriodEndAt: subscription.currentPeriodEndAt,
  };
}

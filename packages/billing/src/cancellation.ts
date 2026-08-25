/**
 * Cancel-at-period-end scheduling — shared by two callers:
 *
 * 1. Organization-deletion cancellation (docs/privacy.md commitment 2) —
 *    `cancelSubscriptionForOrgDeletion`.
 * 2. User-initiated cancellation from the client area
 *    (`POST /api/billing/cancel`) — `cancelSubscriptionAtPeriodEnd`.
 *
 * `POST /subscriptions/{id}/cancel` with `effective_from:
 * 'next_billing_period'` (the Paddle default; API reference 2026-08-25)
 * creates a `scheduled_change { action: 'cancel', effective_at }` and the
 * status stays `active` until then — the org keeps access to what it
 * already paid for, matching the Paddle customer portal's own cancellation
 * behaviour and avoiding an unearned mid-cycle refund obligation.
 * `reactivation.ts` reverses it with `PATCH /subscriptions/{id}
 * { scheduled_change: null }`.
 */
import {
  getSubscription,
  upsertSubscriptionByBillingCustomerId,
  type Db,
  type Subscription,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';

import {
  paddleTimestampToMillis,
  type PaddleSubscription,
  type SubscriptionsScheduleClient,
} from './paddle-client';
import { mapPaddleSubscriptionStatus } from './plans';

export interface CancelSubscriptionDeps {
  readonly db: Db;
  readonly paddle: { readonly subscriptions: SubscriptionsScheduleClient };
}

export type CancelSubscriptionOutcome =
  /** No subscription row for this org — nothing to cancel. */
  | { readonly kind: 'no_subscription' }
  /** Already canceled — no-op, idempotent. */
  | { readonly kind: 'already_canceled' }
  /** Paddle API call succeeded; local row updated to reflect the scheduled cancel. */
  | { readonly kind: 'canceled_at_period_end'; readonly billingSubscriptionId: string };

/** `true` when the live subscription carries a pending cancel. */
export function hasScheduledCancel(subscription: PaddleSubscription): boolean {
  return subscription.scheduled_change?.action === 'cancel';
}

/**
 * Mirrors a live Paddle subscription entity into the local row — the same
 * write webhook.ts performs after a re-fetch. Used after every mutation
 * because the mutation's own response IS the live state we just requested.
 */
export async function mirrorLiveSubscription(
  db: Db,
  organizationId: OrganizationId,
  local: Subscription,
  live: PaddleSubscription,
): Promise<void> {
  await upsertSubscriptionByBillingCustomerId(db, organizationId, {
    billingCustomerId: local.billingCustomerId,
    billingSubscriptionId: live.id,
    status: mapPaddleSubscriptionStatus(live.status),
    // `plan` is not what a cancel/reactivate changes — carried forward.
    plan: local.plan as SubscriptionPlan,
    currentPeriodEndAt:
      paddleTimestampToMillis(live.current_billing_period?.ends_at) ?? local.currentPeriodEndAt,
    cancelAtPeriodEnd: hasScheduledCancel(live),
  });
}

async function scheduleCancel(
  deps: CancelSubscriptionDeps,
  organizationId: OrganizationId,
  subscription: Subscription,
  billingSubscriptionId: string,
): Promise<PaddleSubscription> {
  const updated = await deps.paddle.subscriptions.cancel(billingSubscriptionId, {
    effective_from: 'next_billing_period',
  });
  await mirrorLiveSubscription(deps.db, organizationId, subscription, updated);
  return updated;
}

/**
 * Best-effort cancellation for organization deletion. The caller (route
 * layer) decides what to do when Paddle is unreachable/errors — see
 * `routes/org.ts`'s `DELETE /` handler: it never blocks the deletion itself
 * on this call succeeding, and records an audit row either way so an
 * unfinished cancellation is never silently lost (docs/privacy.md).
 */
export async function cancelSubscriptionForOrgDeletion(
  deps: CancelSubscriptionDeps,
  args: { organizationId: OrganizationId },
): Promise<CancelSubscriptionOutcome> {
  const subscription = await getSubscription(deps.db, args.organizationId);
  if (subscription === null || subscription.billingSubscriptionId === null) {
    return { kind: 'no_subscription' };
  }
  if (subscription.status === 'canceled') {
    return { kind: 'already_canceled' };
  }
  const updated = await scheduleCancel(
    deps,
    args.organizationId,
    subscription,
    subscription.billingSubscriptionId,
  );
  return { kind: 'canceled_at_period_end', billingSubscriptionId: updated.id };
}

export type CancelSubscriptionAtPeriodEndOutcome =
  /** No subscription row for this org — nothing to cancel. */
  | { readonly kind: 'no_subscription' }
  /** Already fully canceled — nothing left to schedule. */
  | { readonly kind: 'already_canceled' }
  /** Already scheduled to cancel (a prior call, or the customer portal) — idempotent no-op, no Paddle call. */
  | { readonly kind: 'already_scheduled'; readonly currentPeriodEndAt: number | null }
  /** Paddle API call succeeded; local row updated. */
  | {
      readonly kind: 'canceled_at_period_end';
      readonly billingSubscriptionId: string;
      readonly currentPeriodEndAt: number | null;
    };

/**
 * User-initiated cancel-at-period-end (`POST /api/billing/cancel`,
 * ORGANIZATION_OWNER only, route layer). NEVER an immediate cancel. Checks
 * `cancelAtPeriodEnd` first so a repeat click is a genuine idempotent
 * no-op instead of a redundant (harmless, but audit-noisy) API call.
 */
export async function cancelSubscriptionAtPeriodEnd(
  deps: CancelSubscriptionDeps,
  args: { organizationId: OrganizationId },
): Promise<CancelSubscriptionAtPeriodEndOutcome> {
  const subscription = await getSubscription(deps.db, args.organizationId);
  if (subscription === null || subscription.billingSubscriptionId === null) {
    return { kind: 'no_subscription' };
  }
  if (subscription.status === 'canceled') {
    return { kind: 'already_canceled' };
  }
  if (subscription.cancelAtPeriodEnd === 1) {
    return { kind: 'already_scheduled', currentPeriodEndAt: subscription.currentPeriodEndAt };
  }
  const updated = await scheduleCancel(
    deps,
    args.organizationId,
    subscription,
    subscription.billingSubscriptionId,
  );
  return {
    kind: 'canceled_at_period_end',
    billingSubscriptionId: updated.id,
    currentPeriodEndAt:
      paddleTimestampToMillis(updated.current_billing_period?.ends_at) ??
      subscription.currentPeriodEndAt,
  };
}

export type { SubscriptionStatus };

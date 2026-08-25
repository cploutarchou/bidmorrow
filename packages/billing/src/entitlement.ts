/**
 * Server-side entitlement service — the SINGLE authority on whether an
 * organization's subscription entitles it to the product. A Checkout
 * success redirect is never proof of payment; only this function (reading
 * `subscriptions`, which only the webhook processor ever writes) is.
 */
import { getFeatureFlag, getSubscription, type Db } from '@bidmorrow/db';
import { FLAG_ENTITLEMENT_ENFORCED } from '@bidmorrow/config';
import type { OrganizationId } from '@bidmorrow/domain';

import type { SubscriptionPlan, SubscriptionStatus } from './plans';

/**
 * A `past_due` subscription stays entitled for this many days past its
 * `current_period_end_at` — a short grace window for a payment retry to
 * succeed (Paddle's dunning retries a failed renewal over roughly this
 * span) before access is cut. Chosen as a product/ops trade-off for V1,
 * not derived from a specific Paddle-documented number — revisit once
 * real dunning data exists.
 */
export const PAST_DUE_GRACE_DAYS = 7;
const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

export type EntitlementReason =
  | 'no_subscription'
  | 'trialing'
  | 'active'
  | 'past_due_grace'
  | 'past_due_expired'
  | 'paused'
  | 'canceled';

export interface Entitlement {
  readonly active: boolean;
  readonly plan: SubscriptionPlan | null;
  readonly status: SubscriptionStatus | null;
  readonly reason: EntitlementReason;
  /** Present only for the `past_due_grace` reason — when the grace window ends (epoch millis). */
  readonly graceEndsAt: number | null;
}

export interface EntitlementReasonInput {
  readonly status: SubscriptionStatus;
  readonly currentPeriodEndAt: number | null;
}

export interface EntitlementReasonResult {
  readonly active: boolean;
  readonly reason: EntitlementReason;
  readonly graceEndsAt: number | null;
}

/**
 * Pure grace-window/status logic, no DB — the piece unit-tested directly;
 * {@link getEntitlement} is the DB-coupled wrapper (D1-tested at the
 * apps/worker level, per this repo's established split — see
 * packages/procurement/src/score.ts vs. its D1 test for the same pattern).
 */
export function reasonFor(
  subscription: EntitlementReasonInput,
  now: number,
): EntitlementReasonResult {
  switch (subscription.status) {
    case 'trialing':
      return { active: true, reason: 'trialing', graceEndsAt: null };
    case 'active':
      return { active: true, reason: 'active', graceEndsAt: null };
    case 'past_due': {
      if (subscription.currentPeriodEndAt === null) {
        // No period boundary to measure a grace window from — fail closed.
        return { active: false, reason: 'past_due_expired', graceEndsAt: null };
      }
      const graceEndsAt = subscription.currentPeriodEndAt + PAST_DUE_GRACE_MS;
      if (now <= graceEndsAt) {
        return { active: true, reason: 'past_due_grace', graceEndsAt };
      }
      return { active: false, reason: 'past_due_expired', graceEndsAt };
    }
    case 'paused':
      // Paused = no billing, no service (Paddle semantics); the customer
      // portal can resume it, which arrives as `subscription.resumed`.
      return { active: false, reason: 'paused', graceEndsAt: null };
    case 'canceled':
      return { active: false, reason: 'canceled', graceEndsAt: null };
    default:
      // The `status` column is DB-CHECK-constrained to the five values
      // above; this branch exists only so an unexpected stored value fails
      // closed instead of throwing.
      return { active: false, reason: 'canceled', graceEndsAt: null };
  }
}

/**
 * Reads the `FLAG_ENTITLEMENT_ENFORCED` global flag (default `false` when
 * absent/malformed — V1-pilot mode, matches every other emergency-lever
 * flag's fail-safe default in this codebase, e.g. `isDigestPaused`). The
 * composition root (`apps/worker`) calls this before gating
 * `/api/org/feed` or digest generation on {@link getEntitlement}'s
 * `active` field — the flag alone never gates anything by itself.
 */
export async function isEntitlementEnforced(db: Db): Promise<boolean> {
  const flag = await getFeatureFlag(db, FLAG_ENTITLEMENT_ENFORCED);
  if (flag === null) return false;
  try {
    return JSON.parse(flag.valueJson) === true;
  } catch {
    return false;
  }
}

export async function getEntitlement(
  db: Db,
  organizationId: OrganizationId,
  now: number = Date.now(),
): Promise<Entitlement> {
  const subscription = await getSubscription(db, organizationId);
  if (subscription === null) {
    return {
      active: false,
      plan: null,
      status: null,
      reason: 'no_subscription',
      graceEndsAt: null,
    };
  }
  const { active, reason, graceEndsAt } = reasonFor(
    {
      status: subscription.status as SubscriptionStatus,
      currentPeriodEndAt: subscription.currentPeriodEndAt,
    },
    now,
  );
  return {
    active,
    plan: subscription.plan as SubscriptionPlan,
    status: subscription.status as SubscriptionStatus,
    reason,
    graceEndsAt,
  };
}

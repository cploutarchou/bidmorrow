/**
 * Plan/price mapping and Stripe subscription status mapping.
 *
 * Price ids are HUMAN-provided per environment (HUMAN_DECISION_BLOCKERS.md
 * item 4) — never invented, never defaulted to a literal. The reverse map
 * (Stripe price id -> our `plan` CHECK vocabulary) is built from whatever
 * the caller's env actually supplies, so a misconfigured/missing price id
 * fails to match rather than silently mapping to the wrong plan.
 */
import type { SubscriptionPlan, SubscriptionStatus } from '@bidmorrow/db';

export type { SubscriptionPlan, SubscriptionStatus };

export interface PriceIds {
  readonly founding: string;
  readonly standard: string;
}

/** Founding-plan seat cap default (docs/product-scope.md: "first 50 customers", owner decision 2026-08-17), overridable via `FLAG_FOUNDING_CAP`. */
export const DEFAULT_FOUNDING_CAP = 50;

/**
 * Flat display price per plan (docs/product-scope.md: "Founding: €29/month
 * ... Standard: €49/month", "Currency is EUR", "Prices are flat (€29/€49, no
 * tax line, no VAT ID field...)"; HUMAN_DECISION_BLOCKERS.md item 4:
 * `BIDMORROW_FOUNDING_MONTHLY` €29/mo, `BIDMORROW_STANDARD_MONTHLY` €49/mo).
 * Hardcoded rather than fetched from the live Stripe `Price` object on every
 * `GET /api/billing/status` call: these are fixed, owner-decided flat prices
 * (docs/product-scope.md: "Pricing: NO CHANGE... never discount below €29"),
 * not values Stripe is the source of truth for at read time — avoids an
 * extra Stripe API round trip on a status-polling endpoint. `amountMinorUnits`
 * matches Stripe's own minor-unit convention (cents) for straightforward
 * frontend formatting.
 */
export interface PlanPrice {
  readonly amountMinorUnits: number;
  readonly currency: 'eur';
  readonly interval: 'month';
}

export const PLAN_PRICES: Record<SubscriptionPlan, PlanPrice> = {
  founding: { amountMinorUnits: 2900, currency: 'eur', interval: 'month' },
  standard: { amountMinorUnits: 4900, currency: 'eur', interval: 'month' },
};

export function planPrice(plan: SubscriptionPlan): PlanPrice {
  return PLAN_PRICES[plan];
}

/** `null` when `priceId` matches neither configured price — never fabricates a plan. */
export function planFromPriceId(priceIds: PriceIds, priceId: string): SubscriptionPlan | null {
  if (priceId === priceIds.founding) return 'founding';
  if (priceId === priceIds.standard) return 'standard';
  return null;
}

export function priceIdForPlan(priceIds: PriceIds, plan: SubscriptionPlan): string {
  return plan === 'founding' ? priceIds.founding : priceIds.standard;
}

/**
 * Maps a live Stripe subscription status (`Stripe.Subscription.Status`:
 * `incomplete | incomplete_expired | trialing | active | past_due |
 * canceled | unpaid | paused` — verified from the installed SDK's
 * `esm/resources/Subscriptions.d.ts`) onto our narrower CHECK vocabulary
 * (`trialing | active | past_due | canceled | unpaid`,
 * docs/data-model.md §9).
 *
 * Checkout-created subscriptions in `subscription` mode finalize their
 * first invoice as part of session completion, so `incomplete` should not
 * normally appear on the webhook path this package drives — but a live
 * re-fetch can still return it (e.g. a 3-D Secure step still pending) or
 * `paused` (a trial that ended without a payment method). Both are honest
 * "not yet/no longer entitled" states without a dedicated column: mapped to
 * the closest existing status rather than fabricating one, and flagged
 * here (not silently) as a known simplification — a future phase adding
 * `incomplete`/`paused` to the schema CHECK would replace this mapping.
 */
export function mapStripeSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'canceled':
    case 'unpaid':
      return status;
    case 'incomplete':
      return 'unpaid';
    case 'incomplete_expired':
    case 'paused':
      return 'canceled';
    default:
      // Unknown future Stripe status: fail safe to the most restrictive
      // (non-entitled) mapping rather than guess.
      return 'canceled';
  }
}

/**
 * The UI-facing payment-state enum for `GET /api/billing/status`
 * (`active | trialing | past_due | unpaid | canceled`). Currently an
 * identity mapping over `SubscriptionStatus` — kept as a distinctly named
 * type/function (rather than exposing `SubscriptionStatus` directly to the
 * route's JSON contract) so the API's payment-state vocabulary can diverge
 * from the DB's storage vocabulary later (e.g. splitting `past_due` into a
 * grace/expired distinction for the UI, mirroring `entitlement.ts`'s
 * `EntitlementReason`) without a breaking rename at every call site.
 */
export type PaymentState = SubscriptionStatus;

export function paymentStateFromStatus(status: SubscriptionStatus): PaymentState {
  return status;
}

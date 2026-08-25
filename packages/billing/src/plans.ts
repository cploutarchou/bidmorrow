/**
 * Plan/price mapping and Paddle subscription status mapping.
 *
 * Price ids are HUMAN-provided per environment (HUMAN_DECISION_BLOCKERS.md
 * item 4) — never invented, never defaulted to a literal. The reverse map
 * (Paddle price id -> our `plan` CHECK vocabulary) is built from whatever
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
 * Flat display price per plan, EXCLUDING tax (owner decision 2026-08-25:
 * Paddle prices are `tax_mode: external`, so a customer pays €29 + the VAT
 * Paddle — as Merchant of Record — is obliged to collect for their
 * country). Hardcoded rather than fetched from the Paddle price on every
 * `GET /api/billing/status`: these are fixed, owner-decided prices
 * (docs/product-scope.md "never discount below €29"), not values the
 * provider is the source of truth for at read time. `amountMinorUnits` is
 * integer cents, matching Paddle's own lowest-unit convention.
 */
export interface PlanPrice {
  readonly amountMinorUnits: number;
  readonly currency: 'eur';
  readonly interval: 'month';
  /** Always `true` on Paddle: VAT is added at checkout for the customer's country. */
  readonly taxExclusive: true;
}

export const PLAN_PRICES: Record<SubscriptionPlan, PlanPrice> = {
  founding: { amountMinorUnits: 2900, currency: 'eur', interval: 'month', taxExclusive: true },
  standard: { amountMinorUnits: 4900, currency: 'eur', interval: 'month', taxExclusive: true },
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
 * Maps a live Paddle subscription status (`active | canceled | past_due |
 * paused | trialing`, Paddle API reference 2026-08-25) onto our CHECK
 * vocabulary (`trialing | active | past_due | paused | canceled`,
 * docs/data-model.md §9). The two sets are identical by design — a
 * `paused` subscription is a first-class, non-entitled state here (the
 * Paddle customer portal can pause). An unknown future status fails safe
 * to the most restrictive (non-entitled) mapping rather than guessing.
 */
export function mapPaddleSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'paused':
    case 'canceled':
      return status;
    default:
      return 'canceled';
  }
}

/**
 * The UI-facing payment-state enum for `GET /api/billing/status`. Currently
 * an identity mapping over `SubscriptionStatus` — kept as a distinctly
 * named type/function so the API's payment-state vocabulary can diverge
 * from the DB's storage vocabulary later without a breaking rename at
 * every call site.
 */
export type PaymentState = SubscriptionStatus;

export function paymentStateFromStatus(status: SubscriptionStatus): PaymentState {
  return status;
}

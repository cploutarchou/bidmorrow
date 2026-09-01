import { api } from './api';

/**
 * Shared billing types + reader for the two surfaces that show subscription
 * state: Settings → Billing and the post-checkout confirmation page.
 *
 * These mirror `packages/billing/src/plans.ts` as string literals rather than
 * importing `@bidmorrow/billing`, which would pull server-side billing code into
 * the web bundle for a handful of enum values. The shape is `GET /api/billing/status`
 * (apps/worker/src/routes/billing.ts).
 */
export type SubscriptionPlan = 'founding' | 'standard';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';

export interface BillingStatus {
  entitlement: {
    active: boolean;
    plan: SubscriptionPlan | null;
    status: SubscriptionStatus | null;
    reason: string;
  };
  subscription: {
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    cancelAtPeriodEnd: boolean;
    currentPeriodEndAt: number | null;
    /** `taxInclusive`: the amount is what the customer pays; Paddle carves the VAT out of it. */
    price: { amountMinorUnits: number; currency: string; interval: string; taxInclusive: boolean };
    paymentState: SubscriptionStatus;
  } | null;
  foundingAvailable: boolean;
  /** Spots left at the founding price; 0 when closed or full. */
  foundingRemaining: number;
  foundingCap: number;
}

export function fetchBillingStatus(): Promise<BillingStatus> {
  return api.get<BillingStatus>('/api/billing/status');
}

/**
 * Delays between polls (ms) while waiting for the Paddle webhook to write the
 * subscription row. Roughly 15 s in total, then the caller stops and says so.
 */
export const SUBSCRIPTION_POLL_DELAYS_MS = [1000, 2000, 3000, 4000, 5000] as const;

export type PollOutcome =
  { kind: 'confirmed'; status: BillingStatus } | { kind: 'not-yet' } | { kind: 'cancelled' };

export interface PollDeps {
  readonly fetchStatus: () => Promise<BillingStatus>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly isCancelled: () => boolean;
}

/**
 * Polls billing status until a subscription row exists, or the attempts run
 * out. Extracted from the confirmation page so the retry behaviour (the part
 * with real failure modes) is testable without a DOM.
 *
 * Two deliberate behaviours:
 *
 * - A thrown request is treated exactly like "not written yet". From the
 *   client's side the two are indistinguishable, and neither is evidence that
 *   the payment failed, so a transient error must not surface as one.
 * - Running out of attempts returns `not-yet`, never a failure. The webhook
 *   can legitimately be slow (it does a Paddle round trip first, and delivery
 *   is at-least-once with no ordering guarantee).
 */
export async function pollForSubscription(
  deps: PollDeps,
  delays: readonly number[] = SUBSCRIPTION_POLL_DELAYS_MS,
): Promise<PollOutcome> {
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (deps.isCancelled()) return { kind: 'cancelled' };
    try {
      const status = await deps.fetchStatus();
      if (deps.isCancelled()) return { kind: 'cancelled' };
      if (status.subscription !== null) return { kind: 'confirmed', status };
    } catch {
      // See above: indistinguishable from "not yet", and not a payment failure.
    }
    const delay = delays[attempt];
    if (delay === undefined) break;
    await deps.sleep(delay);
  }
  return deps.isCancelled() ? { kind: 'cancelled' } : { kind: 'not-yet' };
}

/**
 * Billing composition (Phase 9): wires `@bidmorrow/billing` against the
 * Worker's real bindings/secrets for the `/api/billing/*` and
 * `/api/webhooks/stripe` routes. Kept out of `index.ts`/the route files so
 * it stays independently testable — mirrors `src/digest.ts`'s composition
 * pattern (`resolveDigestProvider`).
 */
import { createStripeClient, type PriceIds } from '@bidmorrow/billing';
import type Stripe from 'stripe';

import type { Env } from './env';

export interface BillingConfig {
  readonly stripe: Stripe;
  readonly priceIds: PriceIds;
  readonly appBaseUrl: string;
}

/**
 * `null` when Stripe secrets/price ids are not configured (local/test
 * default — HUMAN_DECISION_BLOCKERS.md item 4) — callers respond
 * `not_configured` rather than construct a client with an empty key or a
 * fabricated price id. All four names are required together in
 * staging/production (`@bidmorrow/config` `DEPLOYED_REQUIRED_NAMES`).
 */
export function resolveBillingConfig(env: Env): BillingConfig | null {
  if (
    env.STRIPE_SECRET_KEY === undefined ||
    env.STRIPE_PRICE_FOUNDING_MONTHLY === undefined ||
    env.STRIPE_PRICE_STANDARD_MONTHLY === undefined
  ) {
    return null;
  }
  return {
    stripe: createStripeClient(env.STRIPE_SECRET_KEY),
    priceIds: {
      founding: env.STRIPE_PRICE_FOUNDING_MONTHLY,
      standard: env.STRIPE_PRICE_STANDARD_MONTHLY,
    },
    appBaseUrl: env.APP_BASE_URL,
  };
}

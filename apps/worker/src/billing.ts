/**
 * Billing composition (ADR-0011): wires `@bidmorrow/billing` against the
 * Worker's real bindings/secrets for the `/api/billing/*` and
 * `/api/webhooks/paddle` routes. Kept out of `index.ts`/the route files so
 * it stays independently testable — mirrors `src/digest.ts`'s composition
 * pattern (`resolveDigestProvider`).
 */
import {
  createPaddleClient,
  type PaddleClient,
  type PaddleEnvironment,
  type PriceIds,
} from '@bidmorrow/billing';

import type { Env } from './env';

export interface BillingConfig {
  readonly paddle: PaddleClient;
  readonly priceIds: PriceIds;
  readonly environment: PaddleEnvironment;
  /** Public Paddle.js client-side token (`test_…`/`live_…`) — safe to expose. */
  readonly clientToken: string;
  readonly appBaseUrl: string;
}

/** Pure: `sandbox` unless the env says exactly `production`; never guessed from APP_ENV. */
export function resolvePaddleEnvironment(value: string | undefined): PaddleEnvironment | null {
  if (value === 'sandbox' || value === 'production') return value;
  return null;
}

/**
 * `null` when Paddle secrets/price ids are not configured (local/test
 * default — HUMAN_DECISION_BLOCKERS.md item 4) — callers respond
 * `not_configured` rather than construct a client with an empty key or a
 * fabricated price id. All names are required together in
 * staging/production (`@bidmorrow/config` `DEPLOYED_REQUIRED_NAMES`).
 */
export function resolveBillingConfig(env: Env): BillingConfig | null {
  const environment = resolvePaddleEnvironment(env.PADDLE_ENVIRONMENT);
  if (
    env.PADDLE_API_KEY === undefined ||
    env.PADDLE_CLIENT_TOKEN === undefined ||
    env.PADDLE_PRICE_FOUNDING_MONTHLY === undefined ||
    env.PADDLE_PRICE_STANDARD_MONTHLY === undefined ||
    environment === null
  ) {
    return null;
  }
  return {
    paddle: createPaddleClient({ apiKey: env.PADDLE_API_KEY, environment }),
    priceIds: {
      founding: env.PADDLE_PRICE_FOUNDING_MONTHLY,
      standard: env.PADDLE_PRICE_STANDARD_MONTHLY,
    },
    environment,
    clientToken: env.PADDLE_CLIENT_TOKEN,
    appBaseUrl: env.APP_BASE_URL,
  };
}

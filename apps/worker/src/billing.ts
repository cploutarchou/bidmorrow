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
  /**
   * Notification-destination secret. Verifies `paddle-signature` on the
   * webhook AND signs/verifies `custom_data.organization_sig` (provenance)
   * — so it is required for checkout too, not only for the webhook route.
   */
  readonly webhookSecret: string;
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
  const environment = resolvePaddleEnvironment(normalizeSecret(env.PADDLE_ENVIRONMENT));
  const apiKey = normalizeSecret(env.PADDLE_API_KEY);
  const webhookSecret = normalizeSecret(env.PADDLE_WEBHOOK_SECRET);
  const clientToken = normalizeSecret(env.PADDLE_CLIENT_TOKEN);
  const founding = normalizeSecret(env.PADDLE_PRICE_FOUNDING_MONTHLY);
  const standard = normalizeSecret(env.PADDLE_PRICE_STANDARD_MONTHLY);
  if (
    apiKey === undefined ||
    webhookSecret === undefined ||
    clientToken === undefined ||
    founding === undefined ||
    standard === undefined ||
    environment === null
  ) {
    return null;
  }
  // Shape checks, not just presence: a client token (`test_…`/`live_…`) or
  // a `Bearer …` string pasted into PADDLE_API_KEY produces Paddle's
  // `403 authentication_malformed` on every call (seen on staging
  // 2026-08-26). Better to surface `not_configured` than a 500 per click.
  if (
    !API_KEY_SHAPE.test(apiKey) ||
    !PRICE_ID_SHAPE.test(founding) ||
    !PRICE_ID_SHAPE.test(standard)
  ) {
    return null;
  }
  return {
    paddle: createPaddleClient({ apiKey, environment }),
    priceIds: { founding, standard },
    environment,
    clientToken,
    webhookSecret,
    appBaseUrl: env.APP_BASE_URL,
  };
}

const API_KEY_SHAPE = /^pdl_(sdbx|live)_apikey_[A-Za-z0-9_-]+$/;
const PRICE_ID_SHAPE = /^pri_[a-z0-9]{26}$/;

/**
 * Secrets pasted through a dashboard/CLI routinely pick up a trailing
 * newline, surrounding spaces or wrapping quotes — every one of which
 * turns into a malformed `Authorization` header or an unknown price id
 * downstream. Strip them here; an empty result counts as unset.
 */
export function normalizeSecret(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let v = value.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v.length === 0 ? undefined : v;
}

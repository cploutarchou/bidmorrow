/**
 * Feature-flag key constants (docs/data-model.md `feature_flags.key`).
 * Runtime flag values live in the database and are admin-edited; code refers
 * to flags only through these constants so keys stay grep-auditable.
 */

export const FLAG_FOUNDING_PLAN_OPEN = 'founding_plan_open';
/**
 * Founding-plan seat cap (docs/product-scope.md pricing: "first 50
 * customers"). Value shape: a bare JSON integer, e.g. `"50"`. Absent = code
 * default (packages/billing `DEFAULT_FOUNDING_CAP`).
 */
export const FLAG_FOUNDING_CAP = 'founding_cap';
export const FLAG_INGESTION_PAUSED = 'ingestion_paused';
export const FLAG_DIGEST_PAUSED = 'digest_paused';
/**
 * Ingestion CPV/country scope (docs/ted-ingestion-scope.md, ADR-0003).
 * Value shape: `{"cpvFamilies":["72","48","79417000"],"countries":[]}`.
 * Absent = code default (packages/procurement `DEFAULT_INGESTION_SCOPE`).
 */
export const FLAG_INGESTION_CPV_SCOPE = 'ingestion_cpv_scope';
/**
 * Phase 9 billing enforcement switch (docs/architecture.md § billing).
 * Value shape: a bare JSON boolean, e.g. `"true"`. Default (absent) is
 * `false` — V1-pilot mode: subscriptions are tracked but nothing is gated,
 * matching manual pilot provisioning. When `true`, `@bidmorrow/billing`
 * `getEntitlement` gates `/api/org/feed` and digest generation on
 * `entitlement.active`.
 */
export const FLAG_ENTITLEMENT_ENFORCED = 'entitlement_enforced';
/**
 * Stripe Tax switch for Checkout (2026-08-16 owner decision: automatic tax
 * via Stripe Tax replaces the earlier B2B-only-default plan). Value shape: a
 * bare JSON boolean, e.g. `"true"`. Default (absent) is `false` — Checkout
 * keeps creating sessions with today's params (no `automatic_tax`/
 * `tax_id_collection`) until the owner has activated Stripe Tax in the
 * Stripe Dashboard for BOTH test and live mode (registrations, origin
 * address, price `tax_behavior` — none of which this flag or any code path
 * can configure) and flips this flag on. See
 * `packages/billing/src/checkout.ts` for the Checkout-side wiring.
 */
export const FLAG_STRIPE_TAX = 'stripe_tax_enabled';
/**
 * Pre-launch gate (owner decision 2026-08-21: registrations and new
 * subscriptions stay closed in production until the end-of-August launch;
 * staging/local keep full flows for testing and E2E). Value shape: a bare
 * JSON boolean, e.g. `"false"`. Default (absent) is ENVIRONMENT-AWARE:
 * `true` when `APP_ENV === 'production'`, `false` everywhere else — so a
 * fresh production deploy is closed by construction and go-live is a
 * single admin flag flip (`"false"`) with no deploy. Gates: POST
 * /api/auth/sign-up/email and POST /api/billing/checkout (both 403), and
 * drives the public countdown via GET /api/public-config. Log-in,
 * password reset and every existing-account flow stay open.
 */
/**
 * Operator kill-switch for retry attempt-burning during a CONFIRMED upstream
 * outage (ADR-0010 §5.2, deciding the question ADR-0009 flagged). Value
 * shape: a bare JSON boolean, e.g. `"true"`. Default (absent) is `false` —
 * the drain behaves exactly as ADR-0008 §3 specifies.
 *
 * While `true`, `drainFetchRetries`:
 * - processes only the first `FETCH_RETRY_SUSPENDED_CANARY_ROWS` due rows per
 *   run (a recovery probe, not a drain), and
 * - does NOT increment `attempts` on `NOTICE_RENDER_PENDING` outcomes, so the
 *   5-attempt abandonment clock stops running against notices whose only
 *   failure is that TED never rendered them. Genuine `TedRequestError`
 *   outcomes still increment — those are per-notice evidence, outage or not.
 *
 * This is an operator lever, not an algorithm: confirming an outage is a
 * human judgment fed by `RENDER_PENDING_DEGRADED` alerts, exactly the
 * "runtime lever" test `ingestion_paused` passes (ADR-0008 §2). Clearing the
 * flag restores full drain behavior with no attempts lost.
 */
export const FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED = 'fetch_retry_attempts_suspended';

export const FLAG_PRELAUNCH = 'prelaunch';
/**
 * Launch moment shown by the public countdown (GET /api/public-config).
 * Value shape: a JSON string ISO-8601 instant, e.g.
 * `"2026-08-31T21:00:00Z"`. Default (absent): 2026-08-31T21:00:00Z —
 * midnight Aug 31→Sep 1 Cyprus time, i.e. "end of August".
 */
export const FLAG_LAUNCH_DATE = 'launch_date';

/** Default launch instant while `launch_date` is unset (see above). */
export const DEFAULT_LAUNCH_DATE = '2026-08-31T21:00:00Z';

export const FEATURE_FLAG_KEYS = [
  FLAG_FOUNDING_PLAN_OPEN,
  FLAG_FOUNDING_CAP,
  FLAG_INGESTION_PAUSED,
  FLAG_DIGEST_PAUSED,
  FLAG_INGESTION_CPV_SCOPE,
  FLAG_ENTITLEMENT_ENFORCED,
  FLAG_STRIPE_TAX,
  FLAG_PRELAUNCH,
  FLAG_LAUNCH_DATE,
  FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED,
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

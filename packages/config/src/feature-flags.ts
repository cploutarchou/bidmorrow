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

export const FEATURE_FLAG_KEYS = [
  FLAG_FOUNDING_PLAN_OPEN,
  FLAG_FOUNDING_CAP,
  FLAG_INGESTION_PAUSED,
  FLAG_DIGEST_PAUSED,
  FLAG_INGESTION_CPV_SCOPE,
  FLAG_ENTITLEMENT_ENFORCED,
  FLAG_STRIPE_TAX,
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

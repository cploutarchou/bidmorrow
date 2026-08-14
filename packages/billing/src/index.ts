/**
 * @bidmorrow/billing — Stripe checkout/portal/webhooks/entitlements.
 *
 * Phase 2 skeleton: the Stripe integration arrives in Phase 9. This module
 * owns the subscription-status vocabulary mirrored from Stripe
 * (docs/data-model.md §9, `subscriptions.status`).
 */

export const PACKAGE = '@bidmorrow/billing';

/** Subscription lifecycle, mirroring Stripe subscription statuses. */
export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * @bidmorrow/billing — Stripe checkout/portal/webhooks/entitlements.
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

export * from './errors';
export * from './stripe-client';
export * from './stripe-types';
export * from './plans';
export * from './checkout';
export * from './portal';
export * from './cancellation';
export * from './reactivation';
export * from './invoices';
export * from './webhook';
export * from './entitlement';

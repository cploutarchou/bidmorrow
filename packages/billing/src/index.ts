/**
 * @bidmorrow/billing — Paddle Billing (Merchant of Record, ADR-0011):
 * checkout transactions, customer portal, webhooks, entitlements.
 */

export const PACKAGE = '@bidmorrow/billing';

/** Subscription lifecycle — identical to Paddle's `subscription.status` set. */
export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'paused',
  'canceled',
] as const;

export * from './errors';
export * from './paddle-client';
export * from './webhook-signature';
export * from './provenance';
export * from './plans';
export * from './checkout';
export * from './portal';
export * from './cancellation';
export * from './reactivation';
export * from './invoices';
export * from './webhook';
export * from './entitlement';

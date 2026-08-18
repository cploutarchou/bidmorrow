/**
 * Narrow, structurally-typed slices of the real `Stripe` client — every
 * method signature here is copied from the installed `stripe@22.5.0` SDK's
 * own parameter/return types (`import type Stripe from 'stripe'`), so a
 * real `Stripe` instance satisfies every interface below with no adapter
 * code, while unit tests can inject a minimal fake object (no network, no
 * real key) that only implements what a given test needs. This is the
 * "verify from the installed SDK, never memory" contract applied to test
 * seams as well as production wiring.
 */
import type Stripe from 'stripe';

export interface CheckoutSessionsClient {
  create(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session>;
}

export interface BillingPortalSessionsClient {
  create(params: Stripe.BillingPortal.SessionCreateParams): Promise<Stripe.BillingPortal.Session>;
}

export interface SubscriptionsClient {
  retrieve(id: string): Promise<Stripe.Subscription>;
  /**
   * SEC-P9-03 reconciliation: cancels a duplicate Stripe subscription
   * created by a concurrent double-checkout. Signature copied from the
   * installed SDK's `esm/resources/Subscriptions.d.ts`:
   * `cancel(id: string, params?: SubscriptionCancelParams, options?:
   * RequestOptions): Promise<Response<Subscription>>` — `params` is
   * optional there but this client always passes `cancellation_details` for
   * an auditable trail in the Stripe dashboard, so it is required here.
   */
  cancel(id: string, params: Stripe.SubscriptionCancelParams): Promise<Stripe.Subscription>;
}

/** The slice of `Stripe` used by createCheckoutSession/createPortalSession. */
export interface CheckoutStripeClient {
  readonly checkout: { readonly sessions: CheckoutSessionsClient };
  readonly billingPortal: { readonly sessions: BillingPortalSessionsClient };
}

/** The slice of `Stripe` used by the webhook processor (re-fetch, never trust payload). */
export interface WebhookStripeClient {
  readonly subscriptions: SubscriptionsClient;
}

/** The slice of `Stripe` used by signature verification. */
export interface WebhookVerifierClient {
  readonly webhooks: Pick<Stripe.Webhooks, 'constructEventAsync'>;
}

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

/**
 * The slice of `Stripe` used by both `cancellation.ts` (org-deletion +
 * user-initiated cancel-at-period-end) and `reactivation.ts`: a single
 * `subscriptions.update` call toggling `cancel_at_period_end`. Signature
 * copied from the installed SDK's `esm/resources/Subscriptions.d.ts` —
 * `SubscriptionUpdateParams.cancel_at_period_end?: boolean` ("Indicate
 * whether this subscription should cancel at the end of the current
 * period... Defaults to `false`"), response carries the same shape as
 * `retrieve`/`cancel`.
 */
export interface SubscriptionCancelAtPeriodEndClient {
  readonly subscriptions: {
    update(id: string, params: { cancel_at_period_end: boolean }): Promise<Stripe.Subscription>;
  };
}

/**
 * The slice of `Stripe` used by `invoices.ts` (`GET /api/billing/invoices`).
 * Signature copied from the installed SDK's `esm/resources/Invoices.d.ts` —
 * `list(params?: InvoiceListParams, options?: RequestOptions):
 * ApiListPromise<Invoice>` (an `ApiListPromise<T>` resolves to
 * `Response<ApiList<T>>`, and `Response<T> = T & { lastResponse: ... }`, so
 * it structurally satisfies `Promise<Stripe.ApiList<Stripe.Invoice>>` with
 * no adapter). `InvoiceListParams.limit` (from the shared `PaginationParams`
 * it extends, `esm/shared.d.ts`) is documented "between 1 and 100, default
 * 10" — never trusted from the client, always the server's own
 * `INVOICE_LIST_LIMIT`. `InvoiceListParams.customer` is always the
 * SERVER-STORED `stripe_customer_id`, never any id from the request.
 */
export interface InvoicesClient {
  list(params: Stripe.InvoiceListParams): Promise<Stripe.ApiList<Stripe.Invoice>>;
}

export interface InvoicesStripeClient {
  readonly invoices: InvoicesClient;
}

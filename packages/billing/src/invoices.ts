/**
 * `GET /api/billing/invoices` support — lists an organization's Stripe
 * invoices via the SERVER-STORED `stripe_customer_id` (never any id from
 * the request; docs/security.md C6). No card data ever touches our code —
 * this only ever returns Stripe-hosted invoice URLs/PDFs.
 *
 * `stripe.invoices.list({ customer, limit })` (verified from the installed
 * SDK's `esm/resources/Invoices.d.ts` — `list(params?: InvoiceListParams,
 * options?: RequestOptions): ApiListPromise<Invoice>`, `InvoiceListParams`
 * extends the shared `PaginationParams` (`esm/shared.d.ts`) whose `limit`
 * doc comment says "between 1 and 100, default 10" — `INVOICE_LIST_LIMIT`
 * below is well within that range). Sort order: docs.stripe.com was
 * unreachable from this sandbox (egress blocked by the proxy, the same
 * restriction hit elsewhere in this package — see stripe-client.ts's header
 * comment); a WebSearch cross-check independently confirmed Stripe's list
 * endpoints return objects in reverse-chronological order by default (most
 * recently created first), which is what "most recent first" below relies
 * on rather than any client-side re-sort.
 *
 * `Invoice.period_start`/`Invoice.period_end` (verified present at the
 * top level of the `Invoice` interface, not nested under `lines` — the
 * per-price billing period lives on each line item, but this package sells
 * exactly one price per subscription, matching `webhook.ts`'s same
 * single-item assumption for `current_period_end`) are exposed directly
 * rather than reading into `invoice.lines.data[0].period`.
 */
import { getSubscription, type Db } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';
import type Stripe from 'stripe';

import type { InvoicesStripeClient } from './stripe-types';

/** Bounded per docs.stripe.com's 1-100 `limit` range (see file header) — never client-supplied. */
export const INVOICE_LIST_LIMIT = 24;

export interface InvoiceSummary {
  readonly id: string;
  readonly number: string | null;
  readonly status: string | null;
  readonly currency: string;
  readonly amountDue: number;
  readonly amountPaid: number;
  /** Epoch millis (Stripe's `created` is Unix seconds; converted for this codebase's `*_at` millis convention, docs/data-model.md). */
  readonly createdAt: number;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly hostedInvoiceUrl: string | null;
  readonly invoicePdf: string | null;
}

export interface ListInvoicesDeps {
  readonly db: Db;
  readonly stripe: InvoicesStripeClient;
}

export interface ListInvoicesResult {
  readonly invoices: readonly InvoiceSummary[];
  /** `false` when the org has never checked out (no Stripe customer on file yet) — an empty list is a normal state, not an error. */
  readonly hasBillingCustomer: boolean;
}

function toSummary(invoice: Stripe.Invoice): InvoiceSummary {
  return {
    id: invoice.id ?? '',
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    createdAt: invoice.created * 1000,
    periodStartAt: invoice.period_start * 1000,
    periodEndAt: invoice.period_end * 1000,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdf: invoice.invoice_pdf ?? null,
  };
}

/**
 * Requires an existing `stripe_customer_id` (set by a prior checkout) —
 * mirrors `portal.ts`'s `createPortalSession`, except a missing customer is
 * NOT an error here: an org that has never subscribed simply has no
 * invoices yet, so the route returns 200 with an empty list rather than
 * 404ing (unlike the portal, there is nothing actionable to 404 about).
 */
export async function listInvoicesForOrganization(
  deps: ListInvoicesDeps,
  args: { organizationId: OrganizationId },
): Promise<ListInvoicesResult> {
  const subscription = await getSubscription(deps.db, args.organizationId);
  if (subscription === null) {
    return { invoices: [], hasBillingCustomer: false };
  }
  const response = await deps.stripe.invoices.list({
    customer: subscription.stripeCustomerId,
    limit: INVOICE_LIST_LIMIT,
  });
  return { invoices: response.data.map(toSummary), hasBillingCustomer: true };
}

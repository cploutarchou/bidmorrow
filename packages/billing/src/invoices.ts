/**
 * `GET /api/billing/invoices` support — lists an organization's Paddle
 * transactions via the SERVER-STORED `billing_customer_id` (never any id
 * from the request; docs/security.md C6), and resolves the PDF for one of
 * them on demand.
 *
 * Paddle model (API reference 2026-08-25): an invoice is a `completed`/
 * `paid`/`billed`/`past_due` TRANSACTION with an `invoice_number`. The PDF
 * is not on the list payload — `GET /transactions/{id}/invoice` returns a
 * temporary URL, fetched one at a time when the owner clicks, so listing
 * 24 invoices never costs 24 extra API calls.
 *
 * `per_page` is capped at 30 by Paddle; `INVOICE_LIST_LIMIT` stays under
 * it. Ordering is explicit (`billed_at[DESC]`) rather than relying on a
 * default.
 */
import { getSubscription, type Db } from '@bidmorrow/db';
import type { OrganizationId } from '@bidmorrow/domain';

import { NoBillingCustomerError } from './errors';
import {
  PaddleApiError,
  paddleAmountToMinorUnits,
  paddleTimestampToMillis,
  type PaddleTransaction,
  type PaddleTransactionStatus,
  type TransactionsClient,
} from './paddle-client';

export const INVOICE_LIST_LIMIT = 24;

/** Transaction statuses that represent a real, customer-visible charge. */
export const INVOICE_TRANSACTION_STATUSES: readonly PaddleTransactionStatus[] = [
  'billed',
  'paid',
  'completed',
  'past_due',
];

export interface InvoiceSummary {
  readonly id: string;
  readonly number: string | null;
  /** Paddle transaction status: `billed | paid | completed | past_due` (list is filtered to these). */
  readonly status: string;
  readonly currency: string;
  /** Grand total incl. tax, integer minor units. */
  readonly amountDue: number;
  /** `amountDue` when the transaction is `paid`/`completed`, else 0. */
  readonly amountPaid: number;
  readonly createdAt: number;
  readonly periodStartAt: number | null;
  readonly periodEndAt: number | null;
  /** `true` when Paddle has issued an invoice number — the PDF endpoint will work. */
  readonly hasInvoice: boolean;
}

export interface ListInvoicesDeps {
  readonly db: Db;
  readonly paddle: { readonly transactions: Pick<TransactionsClient, 'list' | 'get' | 'invoice'> };
}

export interface ListInvoicesResult {
  readonly invoices: readonly InvoiceSummary[];
  /** `false` when the org has never checked out — an empty list is a normal state, not an error. */
  readonly hasBillingCustomer: boolean;
}

export function toInvoiceSummary(transaction: PaddleTransaction): InvoiceSummary {
  const totals = transaction.details?.totals ?? null;
  const grandTotal = paddleAmountToMinorUnits(totals?.grand_total) ?? 0;
  const paid = transaction.status === 'paid' || transaction.status === 'completed';
  return {
    id: transaction.id,
    number: transaction.invoice_number,
    status: transaction.status,
    currency: (totals?.currency_code ?? transaction.currency_code).toLowerCase(),
    amountDue: grandTotal,
    amountPaid: paid ? grandTotal : 0,
    createdAt:
      paddleTimestampToMillis(transaction.billed_at) ??
      paddleTimestampToMillis(transaction.created_at) ??
      0,
    periodStartAt: paddleTimestampToMillis(transaction.billing_period?.starts_at),
    periodEndAt: paddleTimestampToMillis(transaction.billing_period?.ends_at),
    hasInvoice: transaction.invoice_number !== null,
  };
}

/**
 * Requires an existing `billing_customer_id` — a missing customer is NOT an
 * error here: an org that has never subscribed simply has no invoices yet,
 * so the route returns 200 with an empty list rather than 404ing.
 */
export async function listInvoicesForOrganization(
  deps: ListInvoicesDeps,
  args: { organizationId: OrganizationId },
): Promise<ListInvoicesResult> {
  const subscription = await getSubscription(deps.db, args.organizationId);
  if (subscription === null) {
    return { invoices: [], hasBillingCustomer: false };
  }
  const response = await deps.paddle.transactions.list({
    customer_id: subscription.billingCustomerId,
    status: INVOICE_TRANSACTION_STATUSES,
    per_page: INVOICE_LIST_LIMIT,
    order_by: 'billed_at[DESC]',
  });
  return { invoices: response.data.map(toInvoiceSummary), hasBillingCustomer: true };
}

export type InvoicePdfOutcome =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'no_invoice' }
  | { readonly kind: 'url'; readonly url: string };

/**
 * Resolves the PDF URL for ONE transaction, after proving it belongs to the
 * organization's own Paddle customer (the transaction id comes from the
 * client, so ownership is re-checked server-side — docs/security.md C6).
 * Only https URLs pass through (SEC BILL-R1-03 defense-in-depth).
 */
export async function getInvoicePdfForOrganization(
  deps: ListInvoicesDeps,
  args: { organizationId: OrganizationId; transactionId: string },
): Promise<InvoicePdfOutcome> {
  const subscription = await getSubscription(deps.db, args.organizationId);
  if (subscription === null) {
    throw new NoBillingCustomerError(args.organizationId);
  }
  let transaction: PaddleTransaction;
  try {
    transaction = await deps.paddle.transactions.get(args.transactionId);
  } catch (cause) {
    // A missing id must look exactly like a foreign one (SEC-PDL-03):
    // Paddle's 404 becomes our not_found instead of a distinguishable 502.
    if (cause instanceof PaddleApiError && cause.status === 404) {
      return { kind: 'not_found' };
    }
    throw cause;
  }
  if (transaction.customer_id !== subscription.billingCustomerId) {
    // Belongs to someone else (or nobody): indistinguishable from "does not
    // exist" to the caller by design.
    return { kind: 'not_found' };
  }
  if (transaction.invoice_number === null) {
    return { kind: 'no_invoice' };
  }
  const invoice = await deps.paddle.transactions.invoice(args.transactionId);
  if (typeof invoice.url !== 'string' || !invoice.url.startsWith('https://')) {
    return { kind: 'no_invoice' };
  }
  return { kind: 'url', url: invoice.url };
}

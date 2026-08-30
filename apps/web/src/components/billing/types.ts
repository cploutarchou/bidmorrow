import type { BillingStatus } from '../../lib/billing';

/** `GET /api/billing/invoices`'s `InvoiceSummary` (`packages/billing/src/invoices.ts`). */
export interface Invoice {
  readonly id: string;
  readonly number: string | null;
  /** Paddle transaction status: `billed | paid | completed | past_due`. */
  readonly status: string;
  readonly currency: string;
  readonly amountDue: number;
  readonly amountPaid: number;
  readonly createdAt: number;
  readonly periodStartAt: number | null;
  readonly periodEndAt: number | null;
  /** `true` once Paddle has issued an invoice — the PDF endpoint will work. */
  readonly hasInvoice: boolean;
}

export type InvoicesState =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'not_configured' }
  | { kind: 'provider_error' }
  | { kind: 'error' }
  | { kind: 'ready'; invoices: readonly Invoice[]; hasBillingCustomer: boolean };

/** Non-null `BillingStatus['subscription']` — shared by the subscription card
 * and the cancel/reactivate panel it renders. */
export type ActiveSubscription = NonNullable<BillingStatus['subscription']>;

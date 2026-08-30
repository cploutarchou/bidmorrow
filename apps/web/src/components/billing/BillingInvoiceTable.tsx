import { useState, type ReactElement } from 'react';
import { Download } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import {
  formatCalendarDate,
  formatMinorUnitsAsCurrency,
  invoiceStatusLabel,
  type PaymentStateTone,
} from '../../lib/format';
import type { Invoice, InvoicesState } from './types';

/** Status pill tone for an invoice row. Reuses `.billing-status-badge`'s
 * existing tone vocabulary (`paymentStateTone` in lib/format.ts covers
 * subscription statuses only — `billed | paid | completed | past_due |
 * canceled` is the invoice-status vocabulary, `packages/billing/src/
 * invoices.ts`) so the pill and its print stylesheet override are shared,
 * not duplicated. */
function invoiceStatusTone(status: string): PaymentStateTone {
  if (status === 'paid' || status === 'completed') return 'ok';
  if (status === 'past_due') return 'danger';
  if (status === 'canceled') return 'muted';
  return 'info'; // 'billed' — issued, awaiting payment
}

/**
 * Invoice history table: loading/empty/error/forbidden states and a
 * per-invoice "Download PDF" action that resolves the Paddle-hosted PDF on
 * demand (`GET /api/billing/invoices/:id/pdf` — never a client-fabricated
 * PDF; the URL is temporary so it is fetched at click time, not listed).
 * `hasBillingCustomer: false` with zero invoices is a normal "never
 * checked out" state, not an error (mirrors
 * `packages/billing/src/invoices.ts`'s own framing).
 */
function InvoicePdfButton({ transactionId }: { transactionId: string }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.get<{ url: string }>(
        `/api/billing/invoices/${encodeURIComponent(transactionId)}/pdf`,
      );
      window.open(url, '_blank', 'noopener');
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? 'No PDF available for this invoice yet.'
          : 'Could not fetch the invoice PDF — please try again shortly.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="billing-invoice-actions">
      <button
        type="button"
        className="btn-quiet btn-sm"
        disabled={busy}
        onClick={() => void download()}
      >
        <Download aria-hidden="true" size={14} strokeWidth={2.2} />
        {busy ? 'Fetching…' : 'Download PDF'}
      </button>
      {error !== null && (
        <span role="alert" className="form-error">
          {error}
        </span>
      )}
    </span>
  );
}

/** "Payments and invoices by Paddle" note — Paddle is the Merchant of
 * Record for every charge (docs/product-scope.md, ADR-0011): the wordmark
 * is plain styled text, never a remote-hosted logo image (CSP has no
 * third-party `img-src`, and Paddle brand assets are not self-hosted). */
function PaddleProviderNote(): ReactElement {
  return (
    <p className="billing-provider-note">
      Payments and invoices by <span className="billing-provider-note__mark">Paddle</span>, Merchant
      of Record.
    </p>
  );
}

function invoiceRow(invoice: Invoice): ReactElement {
  const tone = invoiceStatusTone(invoice.status);
  // Paid invoices show what was paid; open/past-due show what is owed
  // (PR-M6-01 — a €0.00 "amount" on an unpaid invoice reads as ambiguous
  // next to its status).
  const amount = formatMinorUnitsAsCurrency(
    invoice.status === 'paid' || invoice.status === 'completed'
      ? invoice.amountPaid
      : invoice.amountDue,
    invoice.currency,
  );
  const period = `${formatCalendarDate(invoice.periodStartAt)} – ${formatCalendarDate(invoice.periodEndAt)}`;
  const statusLabel = invoiceStatusLabel(invoice.status);
  return (
    <tr key={invoice.id}>
      <td data-label="Number">{invoice.number ?? invoice.id}</td>
      <td data-label="Date">{formatCalendarDate(invoice.createdAt)}</td>
      <td data-label="Period">{period}</td>
      <td data-label="Amount" className="billing-invoice-table__amount">
        {amount}
      </td>
      <td data-label="Status">
        <span className={`billing-status-badge billing-status-badge--${tone}`}>{statusLabel}</span>
      </td>
      <td data-label="Actions" className="no-print">
        {invoice.hasInvoice && <InvoicePdfButton transactionId={invoice.id} />}
      </td>
    </tr>
  );
}

export function BillingInvoiceTable({ state }: { state: InvoicesState }): ReactElement {
  return (
    <section className="settings-subsection" aria-labelledby="billing-invoices-heading">
      <h3 id="billing-invoices-heading">Invoice history</h3>
      <PaddleProviderNote />
      {state.kind === 'loading' && (
        <>
          <p className="hint">Loading invoices…</p>
          <div className="billing-invoice-skeleton" aria-hidden="true">
            <div className="billing-invoice-skeleton__row" />
            <div className="billing-invoice-skeleton__row" />
            <div className="billing-invoice-skeleton__row" />
          </div>
        </>
      )}
      {state.kind === 'forbidden' && (
        <p className="hint">Only the organization owner can view billing invoices.</p>
      )}
      {state.kind === 'not_configured' && (
        <p className="hint">Billing is not available right now — please try again shortly.</p>
      )}
      {state.kind === 'provider_error' && (
        <p role="alert" className="form-error">
          Could not reach the billing provider — please try again shortly.
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="form-error">
          Could not load invoices — please try again.
        </p>
      )}
      {state.kind === 'ready' && state.invoices.length === 0 && (
        <p className="hint">No invoices yet.</p>
      )}
      {state.kind === 'ready' && state.invoices.length > 0 && (
        <div className="admin-table-scroll billing-invoice-table">
          <table>
            <caption className="visually-hidden-status">Invoice history</caption>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Date</th>
                <th scope="col">Period</th>
                <th scope="col" className="billing-invoice-table__amount">
                  Amount
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="no-print">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>{state.invoices.map((invoice) => invoiceRow(invoice))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

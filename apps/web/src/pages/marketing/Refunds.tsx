import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';

/**
 * Refund policy. Paddle (Merchant of Record) requires a public refund policy
 * at its own URL for website approval; Paddle also executes every refund —
 * BidMorrow never touches card data or money movement.
 */
export function Refunds(): ReactElement {
  return (
    <>
      <PageMeta {...MARKETING_META.refunds} />

      <p className="mkt-eyebrow">Refunds</p>
      <h1>Refund policy</h1>

      <div className="mkt-prose">
        <h2>Who processes refunds</h2>
        <p>
          Orders are processed by our online reseller and Merchant of Record, Paddle.com. Paddle
          issues every refund to the original payment method; BidMorrow never handles your card
          details. Refunds are also subject to{' '}
          <a href="https://www.paddle.com/legal/checkout-buyer-terms" rel="noopener noreferrer">
            Paddle's buyer terms
          </a>
          .
        </p>

        <h2>First payment — 14-day money-back</h2>
        <p>
          If BidMorrow isn't right for you, ask for a refund within 14 days of your first payment
          and we'll refund it in full — no questions asked. This applies once per organisation, to
          the first subscription payment only.
        </p>

        <h2>Renewals</h2>
        <p>
          Subscriptions are monthly and renew automatically. Renewal payments are not refundable
          because the service is available for the whole period. You can cancel any time from
          account settings; access continues until the end of the paid period and nothing further is
          charged. Cancelling before a renewal is the way to avoid being billed for it.
        </p>

        <h2>Billing errors and duplicates</h2>
        <p>
          A duplicate charge, a charge after cancellation, or any other billing error is refunded in
          full regardless of when it happened. Tell us and we'll sort it out.
        </p>

        <h2>Founding pricing</h2>
        <p>
          Founding pricing is limited to the first 100 customers. If you cancel and later return,
          the founding price is not guaranteed to be available again.
        </p>

        <h2>How to request a refund</h2>
        <p>
          Email <a href="mailto:support@bidmorrow.com">support@bidmorrow.com</a> from the address on
          your account with the invoice number (on the Paddle invoice or under Billing in settings).
          Approved refunds are issued by Paddle within a few business days; your bank may take up to
          10 business days to show them.
        </p>

        <h2>Your statutory rights</h2>
        <p>
          Nothing here limits any rights you have under applicable consumer law. See also our{' '}
          <Link to="/terms">terms</Link> and <Link to="/privacy">privacy policy</Link>.
        </p>
      </div>
    </>
  );
}

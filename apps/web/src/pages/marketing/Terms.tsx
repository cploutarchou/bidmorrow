import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { DECISION_SUPPORT_DISCLAIMER } from '../../copy';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';

export function Terms(): ReactElement {
  return (
    <>
      <PageMeta {...MARKETING_META.terms} />

      <p className="mkt-eyebrow">Terms</p>
      <h1>Terms</h1>

      <p className="mkt-muted">Last updated 30 August 2026.</p>

      <div className="mkt-prose">
        <h2>Decision-support only</h2>
        <p>{DECISION_SUPPORT_DISCLAIMER}</p>

        <h2>Scoped coverage</h2>
        <p>
          BidMorrow's tender coverage is scoped to a documented set of CPV codes; it is not
          exhaustive of all EU procurement. See <Link to="/methodology">methodology</Link> for the
          current scope.
        </p>

        <h2>No guarantees</h2>
        <ul>
          <li>No guarantee any given tender is a good fit for your business.</li>
          <li>
            No guarantee of award, eligibility, or compliance with any procurement requirement.
          </li>
          <li>
            No guarantee of completeness or accuracy of source notices. TED is the source of record.
          </li>
          <li>No guarantee of uninterrupted service.</li>
        </ul>

        <h2>Billing</h2>
        <p>
          Orders are processed by our online reseller and Merchant of Record, Paddle.com, who
          handles payment, VAT/sales tax, invoicing and refunds. Purchases are subject to{' '}
          <a href="https://www.paddle.com/legal/checkout-buyer-terms" rel="noopener noreferrer">
            Paddle's buyer terms
          </a>
          . Prices include VAT; the applicable VAT for your country is shown on the Paddle invoice.
          Subscriptions are monthly; cancel any time from account settings and access continues
          until the end of the paid period. Refunds follow our{' '}
          <Link to="/refunds">refund policy</Link>. Founding pricing is limited to the first 100
          customers and may not be available when you sign up. Once you're on the founding price,
          it's retained for the life of your subscription; it never auto-migrates to the standard
          price.
        </p>

        <h2>Contact</h2>
        {/* Owner decision 2026-08-16: contact is email-only, with no postal
            address published (HUMAN_DECISION_BLOCKERS item 7). */}
        <p>
          Questions about these terms:{' '}
          <a href="mailto:support@bidmorrow.com">support@bidmorrow.com</a>.
        </p>
      </div>
    </>
  );
}

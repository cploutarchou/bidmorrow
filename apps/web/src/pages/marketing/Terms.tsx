import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { DECISION_SUPPORT_DISCLAIMER } from '../../copy';

export function Terms(): ReactElement {
  return (
    <>
      <title>Terms — BidMorrow</title>
      <meta
        name="description"
        content="BidMorrow terms of service summary — final legal text pending."
      />
      <link rel="canonical" href="https://bidmorrow.com/terms" />
      <h1>Terms</h1>
      <p>
        <strong>Final legal text pending.</strong> This page is an honest summary of the terms we
        intend to operate under, not a substitute for lawyer-reviewed terms of service. We will
        replace this page with full legal text before general availability.
      </p>
      <h2>Decision-support only</h2>
      <p>{DECISION_SUPPORT_DISCLAIMER}</p>
      <h2>Scoped coverage</h2>
      <p>
        BidMorrow's tender coverage is scoped to a documented set of CPV codes — it is not
        exhaustive of all EU procurement. See <Link to="/methodology">methodology</Link> for the
        current scope.
      </p>
      <h2>No guarantees</h2>
      <ul>
        <li>No guarantee any given tender is a good fit for your business.</li>
        <li>No guarantee of award, eligibility, or compliance with any procurement requirement.</li>
        <li>
          No guarantee of completeness or accuracy of source notices — TED is the source of record.
        </li>
        <li>No guarantee of uninterrupted service.</li>
      </ul>
      <h2>Billing</h2>
      <p>
        Monthly subscription via Stripe, cancel any time from account settings. Founding pricing is
        limited to the first 50 customers and may not be available when you sign up. Once you're on
        the founding price, it's retained for the life of your subscription — it never auto-migrates
        to the standard price.
      </p>
      <h2>Contact</h2>
      {/* Owner decision 2026-08-16: contact is email-only — no postal
          address published (HUMAN_DECISION_BLOCKERS item 7). */}
      <p>
        Questions about these terms:{' '}
        <a href="mailto:support@bidmorrow.com">support@bidmorrow.com</a>.
      </p>
    </>
  );
}

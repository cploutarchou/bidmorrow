import type { ReactElement } from 'react';
import { Link } from 'react-router';

export function Pricing(): ReactElement {
  return (
    <>
      <title>Pricing — BidMorrow</title>
      <meta
        name="description"
        content="BidMorrow pricing: a founding plan for the first 20 customers, then a standard monthly plan. No annual contracts, no usage fees."
      />
      <link rel="canonical" href="https://bidmorrow.com/pricing" />
      <h1>Pricing</h1>
      <p>Two monthly plans. No annual contract, no usage-based fees, no hidden tiers.</p>
      <div className="pricing-grid">
        <section className="pricing-card" aria-labelledby="founding-plan-heading">
          <h2 id="founding-plan-heading">Founding plan</h2>
          <p className="price">€29 / month excl. VAT</p>
          <p>Limited to our first 20 customers, while we run the founding pilot.</p>
          <Link className="cta" to="/pilot">
            Join the founding pilot
          </Link>
        </section>
        <section className="pricing-card" aria-labelledby="standard-plan-heading">
          <h2 id="standard-plan-heading">Standard plan</h2>
          <p className="price">€49 / month excl. VAT</p>
          <p>Full access once the founding plan is full, or any time after.</p>
          <Link className="cta" to="/signup">
            Sign up
          </Link>
        </section>
      </div>
      <p>
        Prices exclude VAT — the applicable VAT for your country is calculated at checkout
        (businesses can enter a VAT ID). Both plans include the same feed, matching engine, daily
        digest, and support. See <Link to="/how-it-works">how it works</Link> and our{' '}
        <Link to="/methodology">methodology</Link> for exactly what you get.
      </p>
    </>
  );
}

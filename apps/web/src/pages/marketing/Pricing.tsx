import type { ReactElement } from 'react';
import { Link } from 'react-router';

export function Pricing(): ReactElement {
  return (
    <>
      <title>Pricing — BidMorrow</title>
      <meta
        name="description"
        content="BidMorrow pricing: a founding plan for the first 50 customers, then a standard monthly plan. No annual contracts, no usage fees."
      />
      <link rel="canonical" href="https://bidmorrow.com/pricing" />

      <p className="mkt-eyebrow">Pricing</p>
      <h1>Two monthly plans. Nothing hidden.</h1>
      <p className="subheadline">
        Flat EUR pricing. No annual contract, no usage-based fees, no hidden tiers.
      </p>

      <div className="mkt-plans">
        <article className="mkt-plan mkt-plan--founding" aria-labelledby="founding-plan-heading">
          <p className="mkt-plan__cap">Founding — first 50 customers</p>
          <h2 id="founding-plan-heading">Founding plan</h2>
          <p className="mkt-plan__price">€29 / month</p>
          <p className="mkt-plan__desc">
            Limited to our first 50 customers, while we run the founding pilot. The founding price
            is retained for the life of your subscription — it never auto-migrates to the standard
            price.
          </p>
          <ul className="mkt-plan__list">
            <li>The same product every customer gets — no separate "pilot" feature set</li>
            <li>Direct access to the team building BidMorrow for feedback and feature requests</li>
            <li>Cancel any time from account settings</li>
          </ul>
          <Link className="cta" to="/pilot">
            Join the founding pilot
          </Link>
        </article>
        <article className="mkt-plan" aria-labelledby="standard-plan-heading">
          <p className="mkt-plan__cap" aria-hidden="true">
            &nbsp;
          </p>
          <h2 id="standard-plan-heading">Standard plan</h2>
          <p className="mkt-plan__price">€49 / month</p>
          <p className="mkt-plan__desc">
            Full access once the founding plan is full, or any time after.
          </p>
          <ul className="mkt-plan__list">
            <li>Same feed, matching engine, daily digest, and support</li>
            <li>Monthly subscription via Stripe</li>
            <li>Cancel any time from account settings</li>
          </ul>
          <Link className="mkt-btn-quiet" to="/signup">
            Sign up
          </Link>
        </article>
      </div>

      <p className="mkt-plans-foot">
        Both plans include the same feed, matching engine, daily digest, and support. See{' '}
        <Link to="/how-it-works">how it works</Link> and our{' '}
        <Link to="/methodology">methodology</Link> for exactly what you get.
      </p>
    </>
  );
}

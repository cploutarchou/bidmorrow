import type { ReactElement } from 'react';
import { Link } from 'react-router';

export function Pilot(): ReactElement {
  return (
    <>
      <title>Founding pilot — BidMorrow</title>
      <meta
        name="description"
        content="Join BidMorrow's founding pilot: the first 50 customers get the founding price and a direct line to the team building it."
      />
      <link rel="canonical" href="https://bidmorrow.com/pilot" />
      <h1>Founding pilot</h1>
      <p>
        We're opening BidMorrow to a first cohort of up to 50 customers at the founding price of
        €29/month. In exchange, we ask for your honest feedback — what's useful, what's noise, and
        what would make you actually rely on this every day.
      </p>
      <h2>What you get</h2>
      <ul>
        <li>Founding pricing, locked in for as long as you stay subscribed.</li>
        <li>Direct access to the team building BidMorrow for feedback and feature requests.</li>
        <li>The same product every customer gets — no separate "pilot" feature set.</li>
      </ul>
      <h2>What we ask</h2>
      <ul>
        <li>Complete onboarding with your real company profile, not a test one.</li>
        <li>Mark tenders Useful / Not useful so we can see what's working.</li>
        <li>Tell us honestly if the feed isn't useful yet — that's the point of a pilot.</li>
      </ul>
      <Link className="cta" to="/signup">
        Start the founding pilot
      </Link>
    </>
  );
}

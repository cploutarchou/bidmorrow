import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';

export function Pilot(): ReactElement {
  return (
    <>
      <PageMeta {...MARKETING_META.pilot} />

      <p className="mkt-eyebrow">Founding pilot</p>
      <h1>Founding pilot</h1>
      <p className="subheadline">
        We're opening BidMorrow to a first cohort of up to 100 customers at the founding price of
        €29/month. In exchange, we ask for your honest feedback — what's useful, what's noise, and
        what would make you actually rely on this every day.
      </p>

      <div className="mkt-plan-chip mkt-plan-chip--founding" data-reveal>
        <span className="mkt-plan-chip__label">Founding — first 100 customers</span>
        <span className="mkt-plan-chip__price">
          €29<span className="mkt-plan-chip__per">/month</span>
        </span>
      </div>

      <div data-reveal data-reveal-i={1}>
        <h2>What you get</h2>
        <ul className="feature-list">
          <li>Founding pricing, locked in for as long as you stay subscribed.</li>
          <li>Direct access to the team building BidMorrow for feedback and feature requests.</li>
          <li>The same product every customer gets — no separate "pilot" feature set.</li>
        </ul>
      </div>

      <div data-reveal data-reveal-i={2}>
        <h2>What we ask</h2>
        <ul className="feature-list">
          <li>Complete onboarding with your real company profile, not a test one.</li>
          <li>Mark tenders Useful / Not useful so we can see what's working.</li>
          <li>Tell us honestly if the feed isn't useful yet — that's the point of a pilot.</li>
        </ul>
      </div>

      <Link className="cta" to="/signup">
        Start the founding pilot
      </Link>
    </>
  );
}

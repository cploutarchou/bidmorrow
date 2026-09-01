import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';

/**
 * Pricing: 2026-08-21 handoff redesign (`BidMorrow Marketing.dc.html`,
 * page="pricing"): founding €29 highlighted against standard €49, a
 * twelve-month price-hold comparison (€348 vs €588, VAT included), and a billing-facts
 * strip. Facts follow the source: founding price retained for the life of
 * the subscription, same product on both plans, monthly billing via Paddle,
 * cancel from settings.
 */

const FOUNDING_POINTS = [
  'The identical product, with no cut-down pilot tier',
  'A direct line to the people building it',
  'Cancel from settings whenever you like',
];

const STANDARD_POINTS = [
  'The same feed, engine, daily digest and support',
  'Billed monthly through Paddle, our Merchant of Record, with VAT included in the price',
  'Cancel from settings whenever you like',
];

const BILLING_FACTS: { label: string; text: string }[] = [
  {
    label: 'Currency',
    text: 'Euro, charged monthly, VAT included. Nothing is metered and nothing is bundled behind a higher tier.',
  },
  {
    label: 'Founding price',
    text: 'Held for the life of the subscription. It never migrates to the standard price on its own.',
  },
  {
    label: 'Cancelling',
    text: 'From account settings, any time. Access runs to the end of the period you have paid for.',
  },
];

const MONTHS = Array.from({ length: 12 }, (_, index) => index);

export function Pricing(): ReactElement {
  return (
    <>
      <PageMeta {...MARKETING_META.pricing} />

      <p className="mkt-eyebrow">Pricing</p>
      <h1>Two plans. One product.</h1>
      <p className="mkt-standfirst">
        Flat euro pricing, billed monthly. No annual lock-in, no usage meter, no tier that hides the
        useful part.
      </p>

      <div className="mkt-plans">
        <article
          className="mkt-plan mkt-plan--founding"
          aria-labelledby="founding-plan-heading"
          data-reveal
          data-reveal-i={1}
        >
          <div className="mkt-plan__head">
            <p className="mkt-plan__cap">Founding: first 100 customers</p>
            <h2 id="founding-plan-heading">Founding plan</h2>
            <p className="mkt-plan__price">€29 / month</p>
          </div>
          <p className="mkt-plan__desc">
            For the first hundred companies through the door, while the pilot runs. Your price is
            fixed for as long as the subscription lives; it never quietly becomes the standard
            price.
          </p>
          <ul className="mkt-plan__list">
            {FOUNDING_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <Link className="cta" to="/pilot">
            Join the founding pilot
          </Link>
        </article>

        <article
          className="mkt-plan mkt-plan--quiet"
          aria-labelledby="standard-plan-heading"
          data-reveal
          data-reveal-i={2}
        >
          <div className="mkt-plan__head">
            <p className="mkt-plan__cap mkt-plan__cap--quiet">Standard</p>
            <h2 id="standard-plan-heading">Standard plan</h2>
            <p className="mkt-plan__price">€49 / month</p>
          </div>
          <p className="mkt-plan__desc">
            Open once the founding hundred are taken, and any time after.
          </p>
          <ul className="mkt-plan__list">
            {STANDARD_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <Link className="mkt-btn-quiet" to="/signup">
            Sign up
          </Link>
        </article>
      </div>

      <section
        className="mkt-hold"
        aria-label="What the founding price does over twelve months"
        data-reveal
      >
        <div className="mkt-hold__head">
          <p className="mkt-hold__cap">What the founding price does over twelve months</p>
          <p className="mkt-hold__lede">
            One line holds. The other is what the same year costs at the standard price. The gap is
            the whole benefit of being early.
          </p>
        </div>
        <div className="mkt-hold__bars">
          <div className="mkt-hold__line mkt-hold__line--founding">
            <div className="mkt-hold__labels">
              <span>Founding · €29 × 12</span>
              <span className="mkt-hold__total">€348</span>
            </div>
            <span className="mkt-hold__track" aria-hidden="true">
              <span className="mkt-hold__fill" />
            </span>
          </div>
          <div className="mkt-hold__line">
            <div className="mkt-hold__labels">
              <span>Standard · €49 × 12</span>
              <span className="mkt-hold__total">€588</span>
            </div>
            <span className="mkt-hold__track" aria-hidden="true">
              <span className="mkt-hold__fill" />
            </span>
          </div>
        </div>
        <div className="mkt-hold__months" aria-hidden="true">
          {MONTHS.map((month) => (
            <span className="mkt-hold__month" key={month} />
          ))}
        </div>
        <p className="mkt-hold__note">
          Twelve months at the price you joined on. No annual contract to sign for it.
        </p>
      </section>

      <p className="mkt-plans-foot">
        Both plans are the same product: same feed, same engine, same digest, same support.{' '}
        <Link to="/how-it-works">How it works</Link> walks the flow end to end, and{' '}
        <Link to="/methodology">the methodology</Link> shows exactly how a score is built.
      </p>

      <div className="mkt-cellgrid mkt-factgrid" data-reveal>
        {BILLING_FACTS.map((fact) => (
          <div className="mkt-cell" key={fact.label}>
            <p className="mkt-cell__cap">{fact.label}</p>
            <p>{fact.text}</p>
          </div>
        ))}
      </div>
    </>
  );
}

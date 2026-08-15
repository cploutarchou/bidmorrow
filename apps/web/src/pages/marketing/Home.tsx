import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { HEADLINE, PRODUCT_NAME, SUBHEADLINE } from '../../copy';

export function Home(): ReactElement {
  return (
    <>
      <title>{`${PRODUCT_NAME} — Bid/no-bid qualification intelligence for EU public procurement`}</title>
      <meta
        name="description"
        content="BidMorrow scores every TED procurement notice against your company profile so you know which tenders are worth investigating today."
      />
      <link rel="canonical" href="https://bidmorrow.com/" />
      <section className="hero">
        <h1>{HEADLINE}</h1>
        <p className="subheadline">{SUBHEADLINE}</p>
        <Link className="cta" to="/pilot">
          Join the founding pilot
        </Link>
      </section>
      <section>
        <h2>What BidMorrow does</h2>
        <ul className="feature-list">
          <li>Ingests EU procurement notices from TED within a documented CPV scope.</li>
          <li>
            Scores every eligible tender against your company profile — deterministically, with an
            explanation for every point.
          </li>
          <li>
            Surfaces Strong Matches first, then Worth Reviewing, then Possible — no vanity graphs.
          </li>
          <li>Sends one daily digest email, only when there is something worth your attention.</li>
        </ul>
      </section>
    </>
  );
}

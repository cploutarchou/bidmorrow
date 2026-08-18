import type { ReactElement } from 'react';
import { Link } from 'react-router';

export function HowItWorks(): ReactElement {
  return (
    <>
      <title>How it works — BidMorrow</title>
      <meta
        name="description"
        content="How BidMorrow turns TED procurement notices into a daily shortlist of tenders worth investigating."
      />
      <link rel="canonical" href="https://bidmorrow.com/how-it-works" />

      <p className="mkt-eyebrow">How it works</p>
      <h1>How it works</h1>
      <p className="subheadline">
        Five steps from your company profile to a daily shortlist worth acting on.
      </p>

      <ol className="mkt-steps mkt-steps--flow">
        <li className="mkt-step mkt-reveal">
          <span className="mkt-step__num" aria-hidden="true">
            1
          </span>
          <h2>Tell us what you do</h2>
          <p>
            Onboarding asks for your CPV codes, capabilities, keywords, geography, value range, and
            any exclusions. Four editable presets get you started; every field stays editable
            afterwards.
          </p>
        </li>
        <li className="mkt-step mkt-reveal mkt-reveal--d1">
          <span className="mkt-step__num" aria-hidden="true">
            2
          </span>
          <h2>We ingest TED daily</h2>
          <p>
            BidMorrow ingests competition notices from Tenders Electronic Daily (TED) within a
            documented CPV scope — see <Link to="/methodology">methodology</Link> for exactly what's
            covered.
          </p>
        </li>
        <li className="mkt-step mkt-reveal mkt-reveal--d2">
          <span className="mkt-step__num" aria-hidden="true">
            3
          </span>
          <h2>Every eligible tender gets scored</h2>
          <p>
            A deterministic, explainable engine scores each tender against your profile — 0 to 100,
            with a component breakdown for every point and a documented policy for missing data. No
            LLM in the scoring path.
          </p>
        </li>
        <li className="mkt-step mkt-reveal mkt-reveal--d3">
          <span className="mkt-step__num" aria-hidden="true">
            4
          </span>
          <h2>You see Strong Matches first</h2>
          <p>
            Your feed leads with Strong Matches, then Worth Reviewing, then Possible — no vanity
            charts, just the tenders worth your time. Save or ignore with one click; open the
            original TED notice for the source documents.
          </p>
        </li>
        <li className="mkt-step mkt-reveal">
          <span className="mkt-step__num" aria-hidden="true">
            5
          </span>
          <h2>One daily digest</h2>
          <p>One email per day, only when there's something worth your attention.</p>
        </li>
      </ol>
    </>
  );
}

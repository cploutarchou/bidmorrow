import type { ReactElement } from 'react';
import { Link } from 'react-router';
import {
  HEADLINE,
  PRODUCT_NAME,
  RISK_FLAG_STATEMENT,
  SUBHEADLINE,
  UNKNOWN_POLICY_STATEMENT,
} from '../../copy';

export function Home(): ReactElement {
  return (
    <>
      <title>{`${PRODUCT_NAME} — Bid/no-bid qualification intelligence for EU public procurement`}</title>
      <meta
        name="description"
        content="BidMorrow scores every TED procurement notice against your company profile so you know which tenders are worth investigating today."
      />
      <link rel="canonical" href="https://bidmorrow.com/" />

      <section className="hero" aria-labelledby="hero-h">
        <div className="mkt-wrap mkt-hero-grid">
          <div>
            <p className="mkt-eyebrow">Bid/no-bid qualification · EU public procurement · TED</p>
            <h1 id="hero-h">{HEADLINE}</h1>
            <p className="subheadline">{SUBHEADLINE}</p>
            <div className="mkt-cta-row">
              <Link className="cta" to="/pilot">
                Join the founding pilot
              </Link>
              <Link className="mkt-btn-quiet" to="/how-it-works">
                See how it works
              </Link>
            </div>
          </div>
          <aside className="mkt-hero-panel glass" aria-label="Scoped coverage and feed order">
            <p className="mkt-hero-panel__caption">Scoped CPV coverage</p>
            <div className="mkt-chip-row">
              <span className="mkt-chip mkt-chip--solar mkt-chip--mono">CPV 72*</span>
              <span className="mkt-chip mkt-chip--solar mkt-chip--mono">CPV 48*</span>
              <span className="mkt-chip mkt-chip--mono">79417000</span>
            </div>
            <p className="mkt-hero-panel__note">
              Every eligible notice is scored 0–100, deterministically, with an explanation for
              every point.
            </p>
            <p className="mkt-hero-panel__caption">Feed order</p>
            <ol className="mkt-tier-list">
              <li>Strong match</li>
              <li>Worth reviewing</li>
              <li>Possible</li>
            </ol>
          </aside>
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="value-h">
        <div className="mkt-wrap">
          <div className="mkt-section-head mkt-reveal">
            <p className="mkt-eyebrow">What you get</p>
            <h2 id="value-h">What BidMorrow does</h2>
          </div>
          <ul className="feature-list">
            <li className="mkt-reveal">
              Ingests EU procurement notices from TED within a documented CPV scope.
            </li>
            <li className="mkt-reveal mkt-reveal--d1">
              Scores every eligible tender against your company profile — deterministically, with an
              explanation for every point.
            </li>
            <li className="mkt-reveal mkt-reveal--d2">
              Surfaces Strong Matches first, then Worth Reviewing, then Possible — no vanity graphs.
            </li>
            <li className="mkt-reveal mkt-reveal--d3">
              Sends one daily digest email, only when there is something worth your attention.
            </li>
          </ul>
        </div>
      </section>

      <section className="mkt-section mkt-section--deep" aria-labelledby="how-h">
        <div className="mkt-wrap">
          <div className="mkt-section-head mkt-reveal">
            <p className="mkt-eyebrow">How it works</p>
            <h2 id="how-h">From official journal to defensible decision</h2>
            <p className="mkt-section-lede">
              Four steps, no black box: the source is official, the profile is yours, the scoring is
              deterministic, and the verdict is explained.
            </p>
          </div>
          <ol className="mkt-steps">
            <li className="mkt-step mkt-reveal">
              <span className="mkt-step__num" aria-hidden="true">
                1
              </span>
              <h3>TED, ingested daily</h3>
              <p>
                Competition notices from Tenders Electronic Daily — the Publications Office of the
                European Union — within a documented CPV scope.
              </p>
            </li>
            <li className="mkt-step mkt-reveal mkt-reveal--d1">
              <span className="mkt-step__num" aria-hidden="true">
                2
              </span>
              <h3>Your company profile</h3>
              <p>
                CPV codes, capabilities, keywords, geography, value range, and exclusions — set once
                in onboarding, editable forever after.
              </p>
            </li>
            <li className="mkt-step mkt-reveal mkt-reveal--d2">
              <span className="mkt-step__num" aria-hidden="true">
                3
              </span>
              <h3>Deterministic scoring</h3>
              <p>
                Same input, same engine version, same score — every time. No LLM anywhere in the
                scoring path.
              </p>
            </li>
            <li className="mkt-step mkt-reveal mkt-reveal--d3">
              <span className="mkt-step__num" aria-hidden="true">
                4
              </span>
              <h3>Verdict + explanation</h3>
              <p>
                Strong match, worth reviewing, or possible — with the reasoning for every point, and
                a link to the original notice on TED.
              </p>
            </li>
          </ol>
          <p className="mkt-section-link">
            <Link to="/how-it-works">See the full walkthrough →</Link>
          </p>
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="method-h">
        <div className="mkt-wrap">
          <div className="mkt-section-head mkt-reveal">
            <p className="mkt-eyebrow">Methodology</p>
            <h2 id="method-h">Deterministic on purpose</h2>
            <p className="mkt-section-lede">
              A bid/no-bid call deserves a scoring engine you can audit, rerun, and disagree with —
              point by point. Not an AI black box.
            </p>
          </div>
          <div className="mkt-truth-grid">
            <article className="mkt-truth-card glass mkt-reveal">
              <h3>Unknowns are never guessed</h3>
              <p>{UNKNOWN_POLICY_STATEMENT}</p>
            </article>
            <article className="mkt-truth-card glass mkt-reveal mkt-reveal--d1">
              <h3>Risk flags quote their evidence</h3>
              <p>{RISK_FLAG_STATEMENT}</p>
            </article>
          </div>
          <p className="mkt-section-link">
            <Link to="/methodology">Read the full methodology →</Link>
          </p>
        </div>
      </section>

      <section className="mkt-section mkt-section--deep" aria-labelledby="pricing-h">
        <div className="mkt-wrap">
          <div className="mkt-section-head mkt-reveal">
            <p className="mkt-eyebrow">Pricing</p>
            <h2 id="pricing-h">Two monthly plans. Nothing hidden.</h2>
            <p className="mkt-section-lede">
              Flat EUR pricing. No annual contract, no usage-based fees, no hidden tiers.
            </p>
          </div>
          <div className="mkt-plan-row">
            <div className="mkt-plan-chip mkt-plan-chip--founding mkt-reveal">
              <span className="mkt-plan-chip__label">Founding — first 50 customers</span>
              <span className="mkt-plan-chip__price">
                €29<span className="mkt-plan-chip__per">/month</span>
              </span>
            </div>
            <div className="mkt-plan-chip mkt-reveal mkt-reveal--d1">
              <span className="mkt-plan-chip__label">Standard</span>
              <span className="mkt-plan-chip__price">
                €49<span className="mkt-plan-chip__per">/month</span>
              </span>
            </div>
          </div>
          <p className="mkt-section-link">
            <Link to="/pricing">See full pricing details →</Link>
          </p>
        </div>
      </section>
    </>
  );
}

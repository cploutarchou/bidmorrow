import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';

/**
 * "How it works" — 2026-08-21 handoff redesign (`BidMorrow
 * Marketing.dc.html`, page="how"): five numbered flow rows, each with an
 * animated figure in the homepage's motion vocabulary (profile chips, TED
 * scan, score bars, feed sort, digest week). The prototype's three pages
 * share one tab nav; here they stay separate routes behind the shared
 * MarketingLayout nav, so the tab switches become plain links.
 */

const PROFILE_CHIPS = [
  'CPV 72',
  'CPV 48',
  'managed services',
  'integration',
  'CY',
  'GR',
  '€50k–2M',
  'no works contracts',
];

const SCORE_BARS: { label: string; value: string; variant?: 'lead' | 'unknown' }[] = [
  { label: 'CPV fit', value: '35/35', variant: 'lead' },
  { label: 'Capability', value: '14/20' },
  { label: 'Geography', value: '15/15' },
  { label: 'Value', value: '5/10 unknown', variant: 'unknown' },
  { label: 'Runway', value: '5/5' },
];

export function HowItWorks(): ReactElement {
  return (
    <>
      <PageMeta {...MARKETING_META.howItWorks} />

      <p className="mkt-eyebrow">How it works</p>
      <h1>From profile to shortlist, in five moves.</h1>
      <p className="mkt-standfirst">
        Nothing between a published notice and your bid decision that you cannot inspect.
      </p>

      <ol className="mkt-flow">
        <li className="mkt-flow__step">
          <span className="mkt-flow__num" aria-hidden="true">
            1
          </span>
          <span className="mkt-flow__body">
            <h2>Describe the work you want</h2>
            <p>
              CPV codes, capabilities, keywords, the countries you will actually travel to, the
              contract sizes that pay, and the work you refuse outright. Start from a preset if it
              is close enough; every field stays yours to edit afterwards.
            </p>
          </span>
          <span className="mkt-figure mkt-figure--chips" aria-hidden="true">
            {PROFILE_CHIPS.map((chip) => (
              <span className="mkt-fig-chip" key={chip}>
                {chip}
              </span>
            ))}
          </span>
        </li>

        <li className="mkt-flow__step">
          <span className="mkt-flow__num" aria-hidden="true">
            2
          </span>
          <span className="mkt-flow__body">
            <h2>TED lands here every morning</h2>
            <p>
              Competition notices arrive daily from Tenders Electronic Daily — the European Union's
              official procurement journal — within a published CPV scope. A notice outside that
              scope is never ingested, and never scored, however well it might have fitted.
            </p>
            <Link className="mkt-flow__link" to="/methodology">
              See what the scope covers
            </Link>
          </span>
          <span className="mkt-figure mkt-figure--scan" aria-hidden="true">
            <span className="mkt-fig-line" />
            <span className="mkt-fig-line" />
            <span className="mkt-fig-line" />
            <span className="mkt-fig-line" />
            <span className="mkt-fig-line" />
            <span className="mkt-fig-line" />
            <span className="mkt-fig-scanline" />
          </span>
        </li>

        <li className="mkt-flow__step">
          <span className="mkt-flow__num" aria-hidden="true">
            3
          </span>
          <span className="mkt-flow__body">
            <h2>Every lot is scored, not summarised</h2>
            <p>
              A deterministic engine scores each lot against your profile out of a hundred and shows
              where every point came from. A field the notice never published gets a documented
              neutral score, not a guess and not a zero. No language model sits anywhere in the
              scoring path.
            </p>
          </span>
          <span className="mkt-figure mkt-figure--bars" aria-hidden="true">
            {SCORE_BARS.map((bar) => (
              <span
                className={
                  bar.variant === undefined
                    ? 'mkt-fig-bar'
                    : `mkt-fig-bar mkt-fig-bar--${bar.variant}`
                }
                key={bar.label}
              >
                <span className="mkt-fig-bar__row">
                  <span className="mkt-fig-bar__label">{bar.label}</span>
                  <span className="mkt-fig-bar__value">{bar.value}</span>
                </span>
                <span className="mkt-fig-bar__track">
                  <span className="mkt-fig-bar__fill" />
                </span>
              </span>
            ))}
          </span>
        </li>

        <li className="mkt-flow__step">
          <span className="mkt-flow__num" aria-hidden="true">
            4
          </span>
          <span className="mkt-flow__body">
            <h2>Strong matches lead the feed</h2>
            <p>
              Then worth reviewing, then possible. No dashboards to interpret and no vanity charts —
              save it, ignore it, or open the original notice on TED when you want the procurement
              documents themselves.
            </p>
          </span>
          <span className="mkt-figure mkt-figure--feed" aria-hidden="true">
            <span className="mkt-fig-card mkt-fig-card--lead">
              <span className="mkt-fig-card__label">Strong match</span>
              <span className="mkt-fig-card__score">88</span>
            </span>
            <span className="mkt-fig-card">
              <span className="mkt-fig-card__label">Worth reviewing</span>
              <span className="mkt-fig-card__score">74</span>
            </span>
            <span className="mkt-fig-card">
              <span className="mkt-fig-card__label">Possible</span>
              <span className="mkt-fig-card__score">58</span>
            </span>
          </span>
        </li>

        <li className="mkt-flow__step">
          <span className="mkt-flow__num" aria-hidden="true">
            5
          </span>
          <span className="mkt-flow__body">
            <h2>One email, only when it is earned</h2>
            <p>
              A single digest a day, sent only on the days something cleared the floor you set.
              Quiet weeks stay quiet, which is the point.
            </p>
          </span>
          <span className="mkt-figure mkt-figure--digest" aria-hidden="true">
            <span className="mkt-fig-days">
              <span className="mkt-fig-day" />
              <span className="mkt-fig-day mkt-fig-day--send" />
              <span className="mkt-fig-day" />
              <span className="mkt-fig-day" />
              <span className="mkt-fig-day mkt-fig-day--send" />
              <span className="mkt-fig-day" />
              <span className="mkt-fig-day" />
            </span>
            <span className="mkt-fig-note">Two sends in seven days — the rest earned silence.</span>
          </span>
        </li>
      </ol>

      <div className="mkt-cta-row">
        <Link className="cta" to="/pilot">
          Join the founding pilot
        </Link>
        <Link className="mkt-btn-quiet" to="/pricing">
          What it costs
        </Link>
        <span className="mkt-cta-note">€29/month · first 100 customers</span>
      </div>
    </>
  );
}

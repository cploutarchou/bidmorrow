import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { DECISION_SUPPORT_DISCLAIMER, TED_ATTRIBUTION } from '../../copy';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';

/**
 * Methodology: 2026-08-21 handoff redesign (`BidMorrow Marketing.dc.html`,
 * page="method"). The prototype rewrote the disclosure copy for the
 * marketing surface while keeping every fact from copy.ts /
 * docs/matching-engine.md: the 100-point component split with each
 * component's published missing-data policy (CPV fit exempt, because a CPV code
 * is mandatory on every notice), the four component verdicts, the
 * classification tiers, risk flags with confirmed/possible labelling and
 * the eight detected categories, the CPV pre-filter disclosure with what
 * it buys and costs, the five hard exclusions, and scoped-not-exhaustive
 * CPV coverage.
 */

const SCORE_COMPONENTS: { component: string; max: number; policy: string; exempt?: true }[] = [
  {
    component: 'CPV fit',
    max: 35,
    policy: 'n/a, CPV is mandatory on every notice',
    exempt: true,
  },
  {
    component: 'Capability / keyword fit',
    max: 20,
    policy: '50% (10 pts) when no matchable-language text exists',
  },
  { component: 'Geography', max: 15, policy: '50% (7.5 pts) when no NUTS/country on the lot' },
  { component: 'Contract value', max: 10, policy: '50% (5 pts) when no value published' },
  { component: 'Buyer / sector', max: 5, policy: '50% (2.5 pts) when buyer type absent' },
  { component: 'Procedure / contract nature', max: 5, policy: '50% (2.5 pts) when absent' },
  { component: 'Deadline runway', max: 5, policy: '50% (2.5 pts) when no deadline published' },
  {
    component: 'Eligibility / certification signals',
    max: 5,
    policy: '50% (2.5 pts) when no signals detectable',
  },
];

const VERDICTS: { label: string; note: string; tone: 'accent' | 'risk' | 'caution' }[] = [
  {
    label: 'Matched',
    tone: 'accent',
    note: 'The notice states something that fits your profile, and the component takes full or near-full points.',
  },
  {
    label: 'Partial match',
    tone: 'accent',
    note: 'Some overlap (a secondary code, a neighbouring region), scored proportionally instead of all or nothing.',
  },
  {
    label: 'No match',
    tone: 'risk',
    note: 'The notice is explicit and it does not fit. Zero points, and the breakdown names the fact that decided it.',
  },
  {
    label: 'Unknown: neutral applied',
    tone: 'caution',
    note: 'The field was never published, so half that component’s points are applied and the component is marked unknown with a note on what was missing. CPV fit is the exception: every notice must publish a CPV code, so it is never unknown.',
  },
];

const TIERS: { range: string; label: string; note: string; tone: string }[] = [
  {
    range: '80 – 100',
    label: 'Strong match',
    note: 'Read it today. This is the top of your feed.',
    tone: 'mkt-tier__range--strong',
  },
  {
    range: '65 – 79',
    label: 'Worth reviewing',
    note: 'Worth twenty minutes before you decide.',
    tone: 'mkt-tier__range--top',
  },
  {
    range: '45 – 64',
    label: 'Possible match',
    note: 'Adjacent work. Skim it when the week is quiet.',
    tone: '',
  },
  {
    range: '0 – 44',
    label: 'Low fit',
    note: 'Scored and kept, not surfaced. Useful when you widen your profile.',
    tone: 'mkt-tier__range--low',
  },
  {
    range: 'no score',
    label: 'Excluded',
    note: 'A rule you set fired on a known value. The rule is named on the card.',
    tone: 'mkt-tier__range--low',
  },
];

const RISK_TYPES = [
  'Certifications',
  'Security clearance',
  'Insurance',
  'Financial turnover',
  'Prior experience',
  'Framework membership',
  'Local presence',
  'Mandatory references',
];

const EXCLUSION_RULES = [
  'The lot’s country or region is one you excluded.',
  'Its CPV code falls in a family you excluded.',
  'An excluded phrase appears in the notice text.',
  'Its contract nature is one you marked unsupported.',
  'Its deadline runway is shorter than your threshold.',
];

export function Methodology(): ReactElement {
  return (
    <>
      <PageMeta {...MARKETING_META.methodology} />

      <p className="mkt-eyebrow">Methodology</p>
      <h1>Deterministic on purpose.</h1>
      <p className="mkt-standfirst">
        Every number on a card traces to a rule you set and a line the notice actually published.{' '}
        {DECISION_SUPPORT_DISCLAIMER}
      </p>

      <div className="mkt-method">
        {/* `data-reveal`: the component bars grow once when this section scrolls
            into view (marketing.css); content is visible without JS. */}
        <section data-reveal>
          <h2 className="mkt-sec-title">Where the hundred points go</h2>
          <p className="mkt-sec-lede">
            Eight components, fixed maximums, the same arithmetic for every company. Same inputs at
            the same engine version, same score, and each component publishes what happens when the
            notice leaves its data out.
          </p>
          <div className="mkt-comp-head" aria-hidden="true">
            <span>Component</span>
            <span>Max</span>
            <span>If the data is missing</span>
          </div>
          <div className="mkt-comp-list">
            {SCORE_COMPONENTS.map((row) => (
              <div className="mkt-comp-row" key={row.component}>
                <span className="mkt-comp-row__name">
                  {row.component}
                  <span className="mkt-comp-row__track" aria-hidden="true">
                    <span className="mkt-comp-row__fill" />
                  </span>
                </span>
                <span className="mkt-comp-row__max">{row.max}</span>
                <span
                  className={
                    row.exempt === true
                      ? 'mkt-comp-row__policy mkt-comp-row__policy--accent'
                      : 'mkt-comp-row__policy'
                  }
                >
                  {row.policy}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mkt-sec-title">Four things a component can say</h2>
          <div className="mkt-cellgrid mkt-cellgrid--verdicts">
            {VERDICTS.map((verdict) => (
              <div className="mkt-cell" key={verdict.label}>
                <p
                  className={
                    verdict.tone === 'accent'
                      ? 'mkt-cell__cap mkt-cell__cap--accent'
                      : `mkt-cell__cap mkt-cell__cap--${verdict.tone}`
                  }
                >
                  {verdict.label}
                </p>
                <p>{verdict.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mkt-sec-title">What a total means</h2>
          <div className="mkt-tiers">
            {TIERS.map((tier) => (
              <div className="mkt-tier" key={tier.range}>
                <span className={`mkt-tier__range ${tier.tone}`.trim()}>{tier.range}</span>
                <span className="mkt-tier__body">
                  <span className="mkt-tier__label">{tier.label}</span>
                  <span className="mkt-tier__note">{tier.note}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mkt-sec-title">Risk flags quote their evidence</h2>
          <p className="mkt-sec-lede">
            Flags are deterministic pattern matches over the notice text, never a language model's
            hunch. Each one quotes the exact text it fired on, and says whether it is a confirmed
            pattern or a possible requirement you should verify in the source documents. Nothing is
            asserted without the evidence attached.
          </p>
          <div className="mkt-pill-row">
            {RISK_TYPES.map((risk) => (
              <span className="mkt-pill" key={risk}>
                {risk}
              </span>
            ))}
          </div>
          <div className="mkt-evidence-grid">
            <div className="mkt-evidence-card mkt-evidence-card--confirmed">
              <p className="mkt-cell__cap mkt-cell__cap--accent">Confirmed pattern</p>
              <p>The notice says it outright, and the quoted line is on the card.</p>
            </div>
            <div className="mkt-evidence-card mkt-evidence-card--possible">
              <p className="mkt-cell__cap mkt-cell__cap--caution">Possible requirement</p>
              <p>The wording suggests it. Verify in the source documents before you commit.</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mkt-sec-title">The CPV pre-filter, and its cost</h2>
          <p className="mkt-sec-lede">
            Before anything is scored, a tender's CPV code has to share a division, the first two
            digits, with at least one CPV preference you declared. Tenders with no division overlap
            are never scored at all, however well the geography, value, buyer or keywords would have
            fitted.
          </p>
          <div className="mkt-cellgrid">
            <div className="mkt-cell">
              <p className="mkt-cell__cap mkt-cell__cap--accent">What it buys</p>
              <p>A feed that stays relevant, and a product cheap enough to run at this price.</p>
            </div>
            <div className="mkt-cell">
              <p className="mkt-cell__cap mkt-cell__cap--caution">What it costs</p>
              <p>
                A narrow preference list can miss work you would genuinely have wanted. If the feed
                seems too quiet, widen it.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mkt-sec-title">The only five ways out</h2>
          <p className="mkt-sec-lede">
            A tender is dropped without a score only when a value the notice actually published
            trips a rule you set. An unknown field never excludes anything.
          </p>
          <div className="mkt-cellgrid mkt-cellgrid--rows">
            {EXCLUSION_RULES.map((rule, index) => (
              <div className="mkt-cell mkt-rule" key={rule}>
                <span className="mkt-rule__num" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="mkt-rule__text">{rule}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mkt-sec-title">Coverage, stated plainly</h2>
          <p className="mkt-sec-lede">
            Notices are ingested within a documented, configured CPV scope: IT services (CPV 72*),
            software packages and information systems (CPV 48*), and a small reviewed extras list:
            safety consultancy, CPV 79417000. This is scoped coverage, not exhaustive EU coverage: a
            notice outside it is never ingested or scored, regardless of how well it might otherwise
            fit your profile. Codes you declare outside the scope are kept on your profile and shown
            as out of scope until ingestion widens.
          </p>
          <p className="mkt-sec-lede">{TED_ATTRIBUTION}</p>
          <div className="mkt-cta-row">
            <Link className="cta" to="/pilot">
              Join the founding pilot
            </Link>
            <Link className="mkt-btn-quiet" to="/how-it-works">
              Back to how it works
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

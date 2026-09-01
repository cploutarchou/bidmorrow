import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { DECISION_SUPPORT_DISCLAIMER, TED_ATTRIBUTION } from '../../copy';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';
import { SampleVerdictCard } from '../../components/SampleVerdictCard';
import {
  SAMPLE_VERDICTS,
  SAMPLE_VERDICT_ENGINE_VERSION,
  SAMPLE_VERDICT_SCORED_AT,
} from '../../lib/sample-verdicts.generated';

/**
 * The public sample-verdict demo (docs/product-scope.md "Product policy
 * lock", owner decision 2026-08-17).
 *
 * It is a demonstration of EXPLAINABILITY, and explicitly NOT a free tier.
 * The policy's hard boundaries are structural here, not merely unimplemented:
 * there is no input on this page, no profile to create, nothing to subscribe
 * to and no path into the feed. A visitor reads five finished verdicts and
 * either wants their own or does not.
 *
 * Everything factual on the page is generated
 * (`lib/sample-verdicts.generated.ts`) by running the production matching
 * engine over notices TED actually published; see
 * `packages/procurement/src/sample-verdicts.ts`. The only hand-written text
 * per verdict is the one-line "why this one", which is labelled as ours.
 *
 * Two things the page states rather than hides, because a demo whose subject
 * is honesty cannot fudge them:
 *
 * - The supplier profiles are composites of the ICP, not customers.
 * - Every score is as of a fixed date. Deadline runway is a scored
 *   component, so a "live" demo would drift every day and stop matching the
 *   numbers shown.
 */

const SCORED_AT_LABEL = new Date(SAMPLE_VERDICT_SCORED_AT).toISOString().slice(0, 10);

export function SampleVerdicts(): ReactElement {
  return (
    <>
      <PageMeta {...MARKETING_META.sampleVerdicts} />

      <section className="mkt-section">
        <div className="mkt-wrap">
          <p className="mkt-eyebrow">Sample verdicts</p>
          <h1 className="mkt-sec-title">Five real tenders, scored and explained</h1>
          <p className="mkt-standfirst">
            Every number below is what BidMorrow&rsquo;s scoring engine actually returned for a
            notice the EU&rsquo;s Tenders Electronic Daily published, scored against a supplier
            profile of the kind our customers set up. Nothing here is a mock-up: the tenders are
            real, the buyers are real, and each score is broken down to the fact that produced it.
          </p>

          <div className="mkt-truth-grid sample-frame">
            <div className="mkt-truth-card" data-reveal data-reveal-i={1}>
              <h2>What you are looking at</h2>
              <p>
                Five notices, three supplier profiles, one engine run on {SCORED_AT_LABEL}. The
                profiles are composites of the companies we build for (5 to 50 person EU IT and
                cybersecurity consultancies) described in the ordinary trade vocabulary such a firm
                lists on its own site, not in words lifted from any one notice.
              </p>
            </div>
            <div className="mkt-truth-card" data-reveal data-reveal-i={2}>
              <h2>Why the date is pinned</h2>
              <p>
                Deadline runway is one of the eight scored components, so a score is only true as of
                a moment. These were scored on the morning the notices published, which is when a
                subscriber would first have seen them. Re-scoring them today would change the
                numbers and this page would stop matching them.
              </p>
            </div>
            <div className="mkt-truth-card" data-reveal data-reveal-i={3}>
              <h2>What this is not</h2>
              <p>
                It is not a trial and not a free tier. You cannot submit a tender here, build a
                profile, or reach the feed: those need an account, because a verdict is only worth
                anything when it is scored against your company rather than someone else&rsquo;s.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mkt-section mkt-section--deep">
        <div className="mkt-wrap sample-verdicts">
          {/* The generated file also carries verdicts for the category pages
              (e.g. /cybersecurity-tenders); this page shows only its own
              policy-capped curated set. */}
          {SAMPLE_VERDICTS.filter((verdict) => verdict.surfaces.includes('demo')).map((verdict) => (
            <SampleVerdictCard key={verdict.id} verdict={verdict} />
          ))}
        </div>
      </section>

      <section className="mkt-section" data-reveal>
        <div className="mkt-wrap">
          <h2 className="mkt-sec-title">Get verdicts matched to your company</h2>
          <p className="mkt-sec-lede">
            These four were scored against someone else&rsquo;s profile. Yours would score the same
            notices differently, and that is the entire idea.
          </p>
          <p className="mkt-cta-row">
            <Link className="cta" to="/signup">
              Get verdicts matched to your company
            </Link>
          </p>

          <div className="mkt-panel sample-notes">
            <p>
              Scored by matching engine v{SAMPLE_VERDICT_ENGINE_VERSION} on {SCORED_AT_LABEL}. The
              same engine, the same eight components and the same exclusion rules run for every
              customer. See the <Link to="/methodology">methodology</Link> for what each component
              measures and how missing data is handled. For how this plays out in one trade, see{' '}
              <Link to="/cybersecurity-tenders">cybersecurity tenders</Link>.
            </p>
            <p>
              Only one of these five carries a risk flag, and that is a real limit rather than a
              quiet one: flag detection matches English wording plus a few language-independent
              tokens, so the German-language notices above raise none even where a requirement may
              well exist. A flag is a prompt to check the tender documents, never a substitute for
              reading them.
            </p>
            <p>{DECISION_SUPPORT_DISCLAIMER}</p>
            <p>{TED_ATTRIBUTION}</p>
          </div>
        </div>
      </section>
    </>
  );
}

export default SampleVerdicts;

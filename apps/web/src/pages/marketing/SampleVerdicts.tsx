import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { DECISION_SUPPORT_DISCLAIMER, TED_ATTRIBUTION } from '../../copy';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';
import { ScoreBadge } from '../../components/ScoreBadge';
import {
  componentLabel,
  componentStatusLabel,
  formatCalendarDate,
  formatOriginalValue,
  riskConfidenceLabel,
} from '../../lib/format';
import {
  exclusionRuleLabel,
  sampleRecommendation,
  type SampleVerdict,
} from '../../lib/sample-verdicts';
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
 * engine over notices TED actually published — see
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

function VerdictCard({ verdict }: { verdict: SampleVerdict }): ReactElement {
  const isExcluded = verdict.classification === 'EXCLUDED';
  const headingId = `verdict-${verdict.id}`;

  return (
    <article className="sample-verdict" aria-labelledby={headingId}>
      <header className="sample-verdict__head">
        <p className="sample-verdict__supplier">{verdict.supplierLabel}</p>
        <h2 className="sample-verdict__title" id={headingId}>
          {verdict.tenderTitle}
        </h2>
        <p className="sample-verdict__buyer">
          {verdict.buyerName ?? 'Buyer not published'}
          {verdict.country !== null && <> · {verdict.country}</>}
        </p>
        <p className="sample-verdict__badge">
          <ScoreBadge score={verdict.score} classification={verdict.classification} />
        </p>
        <p className="sample-verdict__recommendation">{sampleRecommendation(verdict)}</p>
      </header>

      <dl className="sample-verdict__facts">
        <div>
          <dt>CPV</dt>
          <dd className="num">{verdict.cpvMain}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd className="num">{formatOriginalValue(verdict.valueEur, 'EUR')}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          {/* The DATE, not a countdown. The breakdown below states the
              runway in the engine's own words, and a second relative figure
              computed a different way sat beside it reading one day out —
              two numbers for one fact, on a page about being checkable. */}
          <dd>
            {verdict.deadlineAt === null
              ? 'None published'
              : formatCalendarDate(verdict.deadlineAt)}
          </dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>{verdict.publicationDate ?? 'not published'}</dd>
        </div>
      </dl>

      {isExcluded ? (
        <div className="sample-verdict__exclusion">
          <h3>Why it never reached a score</h3>
          <p>
            {verdict.exclusionRule !== null && exclusionRuleLabel(verdict.exclusionRule)}
            {verdict.exclusionEvidence !== null && (
              <>
                {' — '}
                <span className="num">{verdict.exclusionEvidence}</span>
              </>
            )}
          </p>
          <p className="hint">
            Exclusions run before scoring. This lot was never given a number, so there is no
            breakdown to show — which is the point: the supplier said they do not bid this kind of
            contract, and nothing about the tender can override that.
          </p>
        </div>
      ) : (
        <div className="sample-verdict__breakdown">
          <h3 id={`${headingId}-breakdown`}>Score breakdown</h3>
          <div className="mkt-table-card">
            <table aria-labelledby={`${headingId}-breakdown`}>
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">Points</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {verdict.components.map((component) => (
                  <tr key={component.key}>
                    <th scope="row">{componentLabel(component.key)}</th>
                    <td className="num">
                      {component.points} / {component.maxPoints}
                    </td>
                    <td>{componentStatusLabel(component.status)}</td>
                    <td>{component.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {verdict.riskFlags.length > 0 && (
        <div className="sample-verdict__flags">
          <h3>Detected risk flags</h3>
          <ul>
            {verdict.riskFlags.map((flag) => (
              <li key={`${flag.type}-${flag.explanation}`}>
                <strong>{riskConfidenceLabel(flag.confidence)}</strong> — {flag.explanation}
                {flag.evidence !== null && (
                  <>
                    {' '}
                    <span className="hint">Evidence: “{flag.evidence}”</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="sample-verdict__foot">
        <p className="sample-verdict__why">
          <strong>Why we chose this one:</strong> {verdict.why}
        </p>
        {/* `sourceKind` is rendered, not assumed. Every committed verdict is a
            TED-published notice today and tests/integration/
            sample-verdicts-committed.test.ts fails if that stops being true —
            but the generator can legitimately produce `eforms_example` for one
            of the Publications Office's own sample notices, and if a future
            regeneration ever did, this page must say so rather than present it
            as a tender someone could have bid for. */}
        {verdict.sourceKind === 'ted_notice' && verdict.sourceUrl !== null ? (
          <p>
            <a href={verdict.sourceUrl} target="_blank" rel="noreferrer noopener">
              Read the original notice on TED <span aria-hidden="true">↗</span>
            </a>
          </p>
        ) : (
          <p className="hint">
            This is an official EU eForms example notice, not a published tender. The engine scores
            it exactly as it scores a live one, but nobody could have bid for it.
          </p>
        )}
      </footer>
    </article>
  );
}

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
            <div className="mkt-truth-card">
              <h2>What you are looking at</h2>
              <p>
                Five notices, three supplier profiles, one engine run on {SCORED_AT_LABEL}. The
                profiles are composites of the companies we build for — 5 to 50 person EU IT and
                cybersecurity consultancies — described in the ordinary trade vocabulary such a firm
                lists on its own site, not in words lifted from any one notice.
              </p>
            </div>
            <div className="mkt-truth-card">
              <h2>Why the date is pinned</h2>
              <p>
                Deadline runway is one of the eight scored components, so a score is only true as of
                a moment. These were scored on the morning the notices published, which is when a
                subscriber would first have seen them. Re-scoring them today would change the
                numbers and this page would stop matching them.
              </p>
            </div>
            <div className="mkt-truth-card">
              <h2>What this is not</h2>
              <p>
                It is not a trial and not a free tier. You cannot submit a tender here, build a
                profile, or reach the feed — those need an account, because a verdict is only worth
                anything when it is scored against your company rather than someone else&rsquo;s.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mkt-section mkt-section--deep">
        <div className="mkt-wrap sample-verdicts">
          {SAMPLE_VERDICTS.map((verdict) => (
            <VerdictCard key={verdict.id} verdict={verdict} />
          ))}
        </div>
      </section>

      <section className="mkt-section">
        <div className="mkt-wrap">
          <h2 className="mkt-sec-title">Get verdicts matched to your company</h2>
          <p className="mkt-sec-lede">
            These four were scored against someone else&rsquo;s profile. Yours would score the same
            notices differently — that is the entire idea.
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
              customer — see the <Link to="/methodology">methodology</Link> for what each component
              measures and how missing data is handled.
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

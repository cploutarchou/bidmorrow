import type { ReactElement } from 'react';
import { ScoreBadge } from './ScoreBadge';
import {
  componentLabel,
  componentStatusLabel,
  formatCalendarDate,
  formatOriginalValue,
  riskConfidenceLabel,
} from '../lib/format';
import {
  exclusionRuleLabel,
  sampleRecommendation,
  type SampleVerdict,
} from '../lib/sample-verdicts';

/**
 * One sample verdict, as shown on the public pages (/sample-verdicts and the
 * category pages). Shared so the two surfaces cannot drift: the whole claim
 * of these pages is that a verdict looks the same wherever you meet it.
 *
 * Every value rendered here is engine output from
 * `lib/sample-verdicts.generated.ts` except the one-line "why we chose this
 * one", which is editorial and labelled as ours.
 */
export function SampleVerdictCard({ verdict }: { verdict: SampleVerdict }): ReactElement {
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

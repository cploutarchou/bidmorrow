import type { ReactElement } from 'react';
import {
  CPV_PREFILTER_DISCLOSURE,
  DECISION_SUPPORT_DISCLAIMER,
  HARD_EXCLUSIONS_STATEMENT,
  RISK_FLAG_STATEMENT,
  SCOPED_COVERAGE_STATEMENT,
  TED_ATTRIBUTION,
  UNKNOWN_POLICY_STATEMENT,
} from '../../copy';

const SCORE_COMPONENTS: { component: string; max: number; unknownPolicy: string }[] = [
  { component: 'CPV fit', max: 35, unknownPolicy: 'n/a — CPV is mandatory on every notice' },
  {
    component: 'Capability / keyword fit',
    max: 20,
    unknownPolicy: '50% (10 pts) when no matchable-language text exists',
  },
  {
    component: 'Geography',
    max: 15,
    unknownPolicy: '50% (7.5 pts) when no NUTS/country on the lot',
  },
  { component: 'Contract value', max: 10, unknownPolicy: '50% (5 pts) when no value published' },
  { component: 'Buyer / sector', max: 5, unknownPolicy: '50% (2.5 pts) when buyer type absent' },
  { component: 'Procedure / contract nature', max: 5, unknownPolicy: '50% (2.5 pts) when absent' },
  {
    component: 'Deadline runway',
    max: 5,
    unknownPolicy: '50% (2.5 pts) when no deadline published',
  },
  {
    component: 'Eligibility / certification signals',
    max: 5,
    unknownPolicy: '50% (2.5 pts) when no signals detectable',
  },
];

export function Methodology(): ReactElement {
  return (
    <>
      <title>Methodology — BidMorrow</title>
      <meta
        name="description"
        content="Exactly how BidMorrow scores tenders: score components, missing-data policy, exclusions, risk-flag confidence, and coverage scope."
      />
      <link rel="canonical" href="https://bidmorrow.com/methodology" />

      <p className="mkt-eyebrow">Methodology</p>
      <h1>Deterministic on purpose</h1>
      <p className="subheadline">{DECISION_SUPPORT_DISCLAIMER}</p>

      <h2>Score components</h2>
      <p>
        Every match is scored 0–100 across eight components. The same inputs, at the same engine
        version, always produce the same score.
      </p>
      <div className="mkt-table-card glass">
        <table>
          <caption>Score components and their maximum points</caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Max points</th>
              <th scope="col">If the data is missing</th>
            </tr>
          </thead>
          <tbody>
            {SCORE_COMPONENTS.map((row) => (
              <tr key={row.component}>
                <th scope="row">{row.component}</th>
                <td>{row.max}</td>
                <td>{row.unknownPolicy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mkt-truth-grid">
        <article className="mkt-truth-card glass mkt-reveal">
          <h2>What "Unknown" means</h2>
          <p>{UNKNOWN_POLICY_STATEMENT}</p>
        </article>
        <article className="mkt-truth-card glass mkt-reveal mkt-reveal--d1">
          <h2>Risk flags and confidence</h2>
          <p>{RISK_FLAG_STATEMENT}</p>
        </article>
      </div>

      <div className="mkt-prose">
        <h2>Hard exclusions</h2>
        <p>{HARD_EXCLUSIONS_STATEMENT}</p>

        <h2>The CPV pre-filter</h2>
        <p>{CPV_PREFILTER_DISCLOSURE}</p>

        <h2>Coverage scope</h2>
        <p>{SCOPED_COVERAGE_STATEMENT}</p>

        <h2>Source</h2>
        <p>{TED_ATTRIBUTION}</p>
      </div>
    </>
  );
}

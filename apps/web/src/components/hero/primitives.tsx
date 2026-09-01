import type { ReactElement } from 'react';

import {
  BAND_LABELS,
  type IllustrativeSignal,
  type IllustrativeTender,
  type VerdictBand,
} from './decision-engine-data';

/**
 * Presentational building blocks of the decision-engine visual. Everything
 * here renders inside a `role="img"` parent, so the markup is structure
 * for the eye only: no interactive elements, no headings, no live text
 * that a screen reader should announce (the parent's label does that).
 * Styles live in `styles/hero.css`; there are no inline styles (CSP).
 */

/** A real-shaped TED notice, as the product's feed card shows it. */
export function NoticeCard({ tender }: { readonly tender: IllustrativeTender }): ReactElement {
  return (
    <div className="de-notice">
      <p className="de-notice__buyer">{tender.buyer}</p>
      <p className="de-notice__title">{tender.title}</p>
      <p className="de-notice__meta">
        <span className="de-notice__value">{tender.value}</span>
        <span className="de-notice__deadline">{tender.deadline}</span>
      </p>
      {tender.flag !== undefined && (
        <p className="de-notice__flag">
          <span className="de-notice__flag-kind">Flag</span>
          <span>{tender.flag}</span>
        </p>
      )}
    </div>
  );
}

/** Vertical connector between the notice and the engine, with one travelling dot. */
export function PipelineConnector(): ReactElement {
  return (
    <div className="de-connector">
      <span className="de-connector__dot" />
    </div>
  );
}

const MARK: Readonly<Record<IllustrativeSignal['state'], ReactElement>> = {
  matched: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  ),
  partial: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" className="de-signal__half" />
      <circle cx="8" cy="8" r="5.5" />
    </svg>
  ),
  missed: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
    </svg>
  ),
  unknown: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M5.75 6.25a2.25 2.25 0 1 1 3.1 2.08c-.55.24-.85.65-.85 1.17v.5" />
      <circle cx="8" cy="12.25" r=".75" />
    </svg>
  ),
};

/** One qualification component: name, outcome mark, points earned of the maximum. */
export function SignalRow({ signal }: { readonly signal: IllustrativeSignal }): ReactElement {
  return (
    <li className="de-signal" data-state={signal.state}>
      <span className="de-signal__mark">{MARK[signal.state]}</span>
      <span className="de-signal__label">{signal.label}</span>
      <span className="de-signal__pts">
        {signal.pts}/{signal.max}
      </span>
    </li>
  );
}

const BAND_ORDER: readonly VerdictBand[] = ['strong', 'review', 'possible', 'low'];

/** The four published bands a scored tender can land in; the active one lights up per scene. */
export function VerdictBands(): ReactElement {
  return (
    <div className="de__bands">
      {BAND_ORDER.map((band) => (
        <span className={`de__band de__band--${band}`} key={band}>
          {BAND_LABELS[band]}
        </span>
      ))}
    </div>
  );
}

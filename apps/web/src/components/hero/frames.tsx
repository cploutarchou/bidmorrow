import type { ReactElement } from 'react';

import '../../styles/hero.css';
import { BAND_LABELS, HERO_TENDERS, type IllustrativeTender } from './decision-engine-data';
import { NoticeCard, SignalRow } from './primitives';
import { ScoreRing } from './ScoreRing';

/**
 * Product frames: the hero's primitives standing still, for the
 * "How it works" stage and figures. Each frame is a small, real-shaped
 * piece of the product (a notice as the feed shows it, a profile as
 * onboarding stores it, the engine panel with its rows and score) so
 * the step art and the hero speak one language. Styles: the `.pf` block
 * in `styles/hero.css`. No inline styles (CSP); the only script is the
 * score ring's CSSOM write, shared with the hero.
 *
 * The frames carry real text (points, chips), so they are not hidden
 * from assistive technology; only the decorative ghost cards are.
 */

function cx(...names: (string | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

const DEFAULT_TENDER: IllustrativeTender = HERO_TENDERS[0] as IllustrativeTender;

/** Step 1: the morning's notices from TED, the front one real. */
export function SourceFrame({
  tender = DEFAULT_TENDER,
  className,
}: {
  readonly tender?: IllustrativeTender;
  readonly className?: string;
}): ReactElement {
  return (
    <div className={cx('pf pf--source', className)}>
      <div className="pf__stack">
        <span className="pf__ghost pf__ghost--2" aria-hidden="true" />
        <span className="pf__ghost" aria-hidden="true" />
        <NoticeCard tender={tender} />
      </div>
      <p className="pf__source-line">TED · OJ S · ingested every morning</p>
    </div>
  );
}

export interface ProfileRow {
  readonly label: string;
  readonly chips: readonly string[];
}

/** Step 2: the company profile, row by row, as onboarding stores it. */
export function ProfileFrame({
  rows,
  className,
}: {
  readonly rows: readonly ProfileRow[];
  readonly className?: string;
}): ReactElement {
  return (
    <dl className={cx('pf pf--profile', className)}>
      {rows.map((row) => (
        <div className="pf__row" key={row.label}>
          <dt className="pf__key">{row.label}</dt>
          <dd className="pf__chips">
            {row.chips.map((chip) => (
              <span className="pf__chip" key={chip}>
                {chip}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Step 3: the engine panel, eight components and the score they sum to. */
export function ScoringFrame({
  tender = DEFAULT_TENDER,
  className,
}: {
  readonly tender?: IllustrativeTender;
  readonly className?: string;
}): ReactElement {
  return (
    <div className={cx('pf pf--scoring', className)}>
      <div className="de-engine">
        <p className="de-engine__head">
          <span className="de-engine__title">BidMorrow qualification</span>
          <span className="de-engine__version">engine v1</span>
        </p>
        <ul className="de-signals">
          {tender.signals.map((signal) => (
            <SignalRow signal={signal} key={signal.label} />
          ))}
        </ul>
        <div className="de-score">
          <ScoreRing value={tender.score} mode="draw" className="de-score__ring" />
          <span className="de-score__num">{tender.score}</span>
          <span className="de-score__of">/ 100</span>
          <span className={`de-score__band de-score__band--${tender.band}`}>
            {BAND_LABELS[tender.band]}
          </span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router';
import {
  componentLabel,
  componentMaxPoints,
  formatOriginalValue,
  formatRelativeDeadline,
  riskConfidenceLabel,
} from '../lib/format';
import { usePrefersReducedMotion } from '../lib/motion';
import type { FeedRow } from '../lib/types';
import { ScoreBadge } from './ScoreBadge';

const CLASS_TO_CARD_MODIFIER: Record<FeedRow['classification'], string> = {
  STRONG_MATCH: 'tender-card--strong',
  WORTH_REVIEWING: 'tender-card--worth-reviewing',
  POSSIBLE_MATCH: 'tender-card--possible',
  // Theme Spec §07 low-fit collapse — visual weight only; the bars/expander
  // are already absent because LOW_FIT rows persist no components.
  LOW_FIT: 'tender-card--low',
  // EXCLUDED rows never reach the feed today (listFeedRows filters them);
  // whether they should is a product-scope question, not a styling one.
  EXCLUDED: '',
};

/**
 * Deadline urgency ink (audit minor; thresholds read off the design's own
 * demo-feed data in pages/marketing/Home.tsx rather than invented: 6 days
 * renders risk, 9 and 11 caution, 14 and 21 quiet). Color is supplementary —
 * the text next to it already states the deadline in words, so nothing is
 * conveyed by hue alone.
 */
function deadlineTone(deadlineAt: number | null, now: number): 'risk' | 'caution' | 'quiet' {
  if (deadlineAt === null) return 'quiet';
  const days = Math.floor((deadlineAt - now) / (24 * 60 * 60 * 1000));
  if (days < 7) return 'risk';
  if (days < 14) return 'caution';
  return 'quiet';
}

/** r=16 circle circumference ≈ 100.5. */
const RING_CIRCUMFERENCE = 100.5;

/** SVG attribute only (CSP-safe: `stroke-dasharray` is a presentation
 *  attribute, not the `style=` attribute `style-src` restricts). */
function ringDashLength(score: number): number {
  return Number(((score / 100) * RING_CIRCUMFERENCE).toFixed(1));
}

/** Score ring from the 2026-08-21 handoff card anatomy — decorative
 *  (`aria-hidden`); the ScoreBadge text stays the accessible carrier.
 *
 * Draws its arc on mount: `stroke-dashoffset` starts equal to the dash
 * length itself (fully hidden) and animates to `0` (fully revealed) via
 * the CSS transition on `.score-ring__fill`, exactly like the classic
 * "SVG circle draw" technique — both values are plain SVG attributes, so
 * nothing here touches the CSP-restricted `style=` attribute. Reduced
 * motion (and non-browser environments) render already-drawn on the very
 * first paint, never a flash of an empty ring. */
function ScoreRing({ score }: { score: number }): ReactElement {
  const reducedMotion = usePrefersReducedMotion();
  const [drawn, setDrawn] = useState(reducedMotion);
  useEffect(() => {
    if (reducedMotion) {
      setDrawn(true);
      return;
    }
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion]);
  const dashLength = ringDashLength(score);
  return (
    <span className="score-ring" aria-hidden="true">
      <svg width="38" height="38" viewBox="0 0 38 38">
        <circle cx="19" cy="19" r="16" fill="none" className="score-ring__track" strokeWidth="3" />
        <circle
          cx="19"
          cy="19"
          r="16"
          fill="none"
          className="score-ring__fill"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${dashLength} ${RING_CIRCUMFERENCE}`}
          strokeDashoffset={drawn ? 0 : dashLength}
          transform="rotate(-90 19 19)"
        />
      </svg>
      <span className="score-ring__num">{score}</span>
    </span>
  );
}

export function TenderCard({
  item,
  now,
  onSave,
  onIgnore,
}: {
  item: FeedRow;
  now: number;
  onSave: (matchId: string, nextSaved: boolean) => void;
  onIgnore: (matchId: string, nextIgnored: boolean) => void;
}): ReactElement {
  const modifier = CLASS_TO_CARD_MODIFIER[item.classification];
  // Handing the current location forward is what lets App.tsx open this
  // tender as a slide-over over the feed instead of navigating away. It stays
  // a real <Link>, so middle-click, ctrl-click and "copy link address" all
  // still resolve to the full page — a click handler would have broken those.
  const location = useLocation();
  return (
    <article className={modifier.length > 0 ? `tender-card ${modifier}` : 'tender-card'}>
      <div className="tender-card__head">
        <span className="tender-card__id">
          {item.score !== null && <ScoreRing score={item.score} />}
          <ScoreBadge score={item.score} classification={item.classification} />
        </span>
        <p
          className={`tender-card__deadline num tender-card__deadline--${deadlineTone(item.deadlineAt, now)}`}
        >
          {formatRelativeDeadline(item.deadlineAt, now)}
        </p>
      </div>
      <h3 className="tender-card__title">
        <Link to={`/app/tenders/${item.matchId}`} state={{ backgroundLocation: location }}>
          {item.title}
        </Link>
      </h3>
      <p className="tender-card__meta">
        {item.buyerName ?? 'Buyer not published'} · {item.country ?? 'Country not published'} ·{' '}
        {formatOriginalValue(item.valueOriginalAmount, item.valueOriginalCurrency)}
      </p>
      {item.topComponents.length > 0 && (
        <ul className="card-anatomy" aria-label="Top score components">
          {item.topComponents.map((component) => {
            const max = componentMaxPoints(component.componentKey);
            return (
              <li key={component.componentKey} className="card-anatomy__row">
                <span className="card-anatomy__name">{componentLabel(component.componentKey)}</span>
                {max !== null && (
                  // Native <progress>, never an inline `style` width — CSP is
                  // `style-src 'self'` with no unsafe-inline (docs/conventions/
                  // frontend-engineer.md); the fill is styled entirely via
                  // ::-webkit-progress-value/::-moz-progress-bar in styles/base.css.
                  <progress
                    className="score-bar score-bar--sm"
                    value={component.points}
                    max={max}
                    aria-hidden="true"
                  />
                )}
                <span className="card-anatomy__pts num">
                  +{component.points}
                  {max !== null ? `/${max}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {item.topComponents.length > 0 && (
        <details className="tender-card__why">
          <summary>Why this score</summary>
          {/* The engine's own explanation strings for the card's top
              components — already in the feed payload, previously fetched
              and never shown. The full eight-component breakdown stays one
              click away in the tender sheet. */}
          <ul>
            {item.topComponents.map((component) => (
              <li key={component.componentKey}>{component.explanation}</li>
            ))}
          </ul>
        </details>
      )}
      {item.topRiskFlag !== null && (
        <p className="tender-card__risk">
          ⚠ {item.topRiskFlag.explanation} ({riskConfidenceLabel(item.topRiskFlag.confidence)})
        </p>
      )}
      <div className="tender-card__actions">
        <button
          type="button"
          className="btn-quiet btn-sm"
          aria-pressed={item.savedByYou}
          onClick={() => onSave(item.matchId, !item.savedByYou)}
        >
          {item.savedByYou ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          className="btn-quiet btn-sm"
          aria-pressed={item.ignoredByYou}
          onClick={() => onIgnore(item.matchId, !item.ignoredByYou)}
        >
          {item.ignoredByYou ? 'Ignored' : 'Ignore'}
        </button>
      </div>
    </article>
  );
}

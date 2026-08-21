import type { ReactElement } from 'react';
import { Link } from 'react-router';
import {
  componentLabel,
  componentMaxPoints,
  formatOriginalValue,
  formatRelativeDeadline,
  riskConfidenceLabel,
} from '../lib/format';
import type { FeedRow } from '../lib/types';
import { ScoreBadge } from './ScoreBadge';

const CLASS_TO_CARD_MODIFIER: Record<FeedRow['classification'], string> = {
  STRONG_MATCH: 'tender-card--strong',
  WORTH_REVIEWING: 'tender-card--worth-reviewing',
  POSSIBLE_MATCH: 'tender-card--possible',
  LOW_FIT: '',
  EXCLUDED: '',
};

/** r=16 circle circumference ≈ 100.5 — SVG attributes only (CSP-safe). */
function ringDash(score: number): string {
  return `${((score / 100) * 100.5).toFixed(1)} 100.5`;
}

/** Score ring from the 2026-08-21 handoff card anatomy — decorative
 *  (`aria-hidden`); the ScoreBadge text stays the accessible carrier. */
function ScoreRing({ score }: { score: number }): ReactElement {
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
          strokeDasharray={ringDash(score)}
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
  return (
    <article className={modifier.length > 0 ? `tender-card ${modifier}` : 'tender-card'}>
      <div className="tender-card__head">
        <span className="tender-card__id">
          {item.score !== null && <ScoreRing score={item.score} />}
          <ScoreBadge score={item.score} classification={item.classification} />
        </span>
        <p className="tender-card__deadline num">{formatRelativeDeadline(item.deadlineAt, now)}</p>
      </div>
      <h3 className="tender-card__title">
        <Link to={`/app/tenders/${item.matchId}`}>{item.title}</Link>
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
                  // `style-src 'self'` with no unsafe-inline (.claude/agents/
                  // frontend-engineer.md); the fill is styled entirely via
                  // ::-webkit-progress-value/::-moz-progress-bar in styles.css.
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

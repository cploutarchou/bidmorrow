import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { formatOriginalValue, formatRelativeDeadline, riskConfidenceLabel } from '../lib/format';
import type { FeedRow } from '../lib/types';
import { ScoreBadge } from './ScoreBadge';

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
  return (
    <article className="tender-card">
      <ScoreBadge score={item.score} classification={item.classification} />
      <h3>
        <Link to={`/app/tenders/${item.matchId}`}>{item.title}</Link>
      </h3>
      <p className="tender-card__meta">
        {item.buyerName ?? 'Buyer not published'} · {item.country ?? 'Country not published'} ·{' '}
        {formatOriginalValue(item.valueOriginalAmount, item.valueOriginalCurrency)}
      </p>
      <p className="tender-card__deadline">{formatRelativeDeadline(item.deadlineAt, now)}</p>
      {item.topComponents.length > 0 && (
        <ul className="tender-card__reasons">
          {item.topComponents.map((component) => (
            <li key={component.componentKey}>{component.explanation}</li>
          ))}
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
          aria-pressed={item.savedByYou}
          onClick={() => onSave(item.matchId, !item.savedByYou)}
        >
          {item.savedByYou ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          aria-pressed={item.ignoredByYou}
          onClick={() => onIgnore(item.matchId, !item.ignoredByYou)}
        >
          {item.ignoredByYou ? 'Ignored' : 'Ignore'}
        </button>
      </div>
    </article>
  );
}

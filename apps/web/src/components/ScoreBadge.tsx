import type { ReactElement } from 'react';
import { classificationLabel, type Classification } from '../lib/format';

const CLASS_TO_CSS: Record<Classification, string> = {
  STRONG_MATCH: 'score-badge--strong',
  WORTH_REVIEWING: 'score-badge--worth-reviewing',
  POSSIBLE_MATCH: 'score-badge--possible',
  LOW_FIT: 'score-badge--low',
  EXCLUDED: 'score-badge--excluded',
};

/**
 * Score badge: classification is always rendered as text, never conveyed by
 * color alone (WCAG 2.2 AA — see .claude/agents/frontend.md).
 */
export function ScoreBadge({
  score,
  classification,
}: {
  score: number | null;
  classification: Classification;
}): ReactElement {
  return (
    <span className={`score-badge ${CLASS_TO_CSS[classification]}`}>
      {score !== null ? `${score} / 100 — ` : ''}
      {classificationLabel(classification)}
    </span>
  );
}

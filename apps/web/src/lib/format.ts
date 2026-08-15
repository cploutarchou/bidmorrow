/**
 * Pure formatting/mapping utilities kept out of components per the frontend
 * agent's thin-components rule (component logic under unit test; components
 * stay presentational). No `Intl` locale is hardcoded beyond the browser
 * default so this respects the user's locale.
 */

export type Classification =
  'STRONG_MATCH' | 'WORTH_REVIEWING' | 'POSSIBLE_MATCH' | 'LOW_FIT' | 'EXCLUDED';

/**
 * Text label for a classification — status must never be conveyed by color
 * alone (WCAG 2.2 AA), so every score badge renders this label alongside any
 * color treatment.
 */
export function classificationLabel(classification: Classification): string {
  switch (classification) {
    case 'STRONG_MATCH':
      return 'Strong match';
    case 'WORTH_REVIEWING':
      return 'Worth reviewing';
    case 'POSSIBLE_MATCH':
      return 'Possible match';
    case 'LOW_FIT':
      return 'Low fit';
    case 'EXCLUDED':
      return 'Excluded';
  }
}

/**
 * Formats a deadline timestamp (epoch ms) relative to `now` (epoch ms) in
 * plain language. Past deadlines are stated explicitly rather than as a
 * negative number of days.
 */
export function formatRelativeDeadline(deadlineAt: number | null, now: number): string {
  if (deadlineAt === null) return 'No deadline published';
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((deadlineAt - now) / msPerDay);
  if (days < 0) return 'Deadline passed';
  if (days === 0) return 'Deadline today';
  if (days === 1) return 'Deadline tomorrow';
  return `Deadline in ${days} days`;
}

/**
 * Formats an original-currency value for display (never converts — the
 * original currency is what the buyer published; EUR-equivalent is a
 * separate, explicitly labelled figure elsewhere).
 */
export function formatOriginalValue(amount: number | null, currency: string | null): string {
  if (amount === null) return 'Value not published';
  const currencyCode = currency ?? 'EUR';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currencyCode}`;
  }
}

/** Score badge status text, distinct from the classification label (used together, e.g. "84.5 / 100 — Strong match"). */
export function formatScoreLine(score: number, classification: Classification): string {
  return `${score} / 100 — ${classificationLabel(classification)}`;
}

const RISK_CONFIDENCE_LABEL: Record<string, string> = {
  HIGH: 'Confirmed pattern',
  POSSIBLE: 'Possible requirement — verify in source documents',
};

export function riskConfidenceLabel(confidence: string): string {
  return RISK_CONFIDENCE_LABEL[confidence] ?? confidence;
}

const COMPONENT_STATUS_LABEL: Record<string, string> = {
  MATCHED: 'Matched',
  PARTIAL: 'Partial match',
  NO_MATCH: 'No match',
  UNKNOWN: 'Unknown — neutral score applied',
};

export function componentStatusLabel(status: string): string {
  return COMPONENT_STATUS_LABEL[status] ?? status;
}

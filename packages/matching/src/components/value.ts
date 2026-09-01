/**
 * Contract value (10 pts). docs/matching-engine.md §Contract value.
 *
 * Bands are expressed relative to `min`/`max`; when only one bound is set
 * the other bound is treated as unbounded (no upper/lower pressure from the
 * missing side) — an interpretation decision the spec leaves open.
 */
import { COMPONENT_MAX, UNKNOWN_NEUTRAL } from '../index';
import type { ComponentResult, LotInput, OrgProfile } from '../types';

function formatEur(amount: number): string {
  return `€${Math.round(amount).toLocaleString('en-US')}`;
}

export function scoreValue(lot: LotInput, org: OrgProfile): ComponentResult {
  const maxPoints = COMPONENT_MAX.value;

  if (lot.valueEur === null) {
    const currencyNote =
      lot.originalCurrency != null ? ` (published in ${lot.originalCurrency}, not converted)` : '';
    return {
      key: 'value',
      points: maxPoints * UNKNOWN_NEUTRAL,
      maxPoints,
      status: 'UNKNOWN',
      explanation: `Value: not published or not convertible to EUR${currencyNote}. Neutral score applied.`,
    };
  }

  const { minEur, maxEur } = org.valueRange;
  const value = lot.valueEur;
  const baseStatus = lot.valueIsDerived ? 'PARTIAL' : 'MATCHED';

  if (minEur === undefined && maxEur === undefined) {
    return {
      key: 'value',
      points: maxPoints * UNKNOWN_NEUTRAL,
      maxPoints,
      status: 'UNKNOWN',
      explanation: 'Value: no value preference configured. Neutral score applied.',
    };
  }

  const withinRange =
    (minEur === undefined || value >= minEur) && (maxEur === undefined || value <= maxEur);
  if (withinRange) {
    return {
      key: 'value',
      points: 10,
      maxPoints,
      status: baseStatus,
      explanation: `Value: ${formatEur(value)} within your ${rangeText(minEur, maxEur)} range`,
    };
  }

  if (minEur !== undefined && value < minEur) {
    const ratio = value / minEur;
    if (ratio >= 0.5) {
      return band(6, value, minEur, maxEur, baseStatus, '50–100% of your minimum');
    }
    if (ratio >= 0.25) {
      return band(3, value, minEur, maxEur, baseStatus, '25–50% of your minimum');
    }
    return band(0, value, minEur, maxEur, 'NO_MATCH', 'below 25% of your minimum');
  }

  if (maxEur !== undefined && value > maxEur) {
    const ratio = value / maxEur;
    if (ratio <= 1.5) {
      return band(6, value, minEur, maxEur, baseStatus, '100–150% of your maximum');
    }
    if (ratio <= 2.5) {
      return band(3, value, minEur, maxEur, baseStatus, '150–250% of your maximum');
    }
    return band(0, value, minEur, maxEur, 'NO_MATCH', 'more than 250% of your maximum');
  }

  return band(0, value, minEur, maxEur, 'NO_MATCH', 'outside your range');
}

function rangeText(minEur: number | undefined, maxEur: number | undefined): string {
  if (minEur !== undefined && maxEur !== undefined) {
    return `${formatEur(minEur)}–${formatEur(maxEur)}`;
  }
  if (minEur !== undefined) {
    return `${formatEur(minEur)}+`;
  }
  if (maxEur !== undefined) {
    return `up to ${formatEur(maxEur)}`;
  }
  return 'unbounded';
}

function band(
  points: number,
  value: number,
  minEur: number | undefined,
  maxEur: number | undefined,
  status: ComponentResult['status'],
  label: string,
): ComponentResult {
  return {
    key: 'value',
    points,
    maxPoints: COMPONENT_MAX.value,
    status,
    explanation: `Value: ${formatEur(value)} is ${label} (your range: ${rangeText(minEur, maxEur)})`,
  };
}

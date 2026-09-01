/**
 * Deadline runway (5 pts). docs/matching-engine.md §Deadline runway.
 *
 * This component never itself hard-excludes — the "< threshold" tier is a
 * scoring signal only. The corresponding hard exclusion is evaluated
 * separately by `exclusions.ts` so callers can short-circuit before scoring.
 */
import { COMPONENT_MAX, UNKNOWN_NEUTRAL } from '../index';
import type { ComponentResult } from '../types';

export const DEFAULT_MINIMUM_DAYS_REMAINING = 10;

function daysRemaining(deadlineAt: number, scoringTime: number): number {
  return (deadlineAt - scoringTime) / 86_400_000;
}

export function scoreDeadline(
  deadlineAt: number | null,
  scoringTime: number,
  minimumDaysRemaining: number | undefined,
): ComponentResult {
  const maxPoints = COMPONENT_MAX.deadline;

  if (deadlineAt === null) {
    return {
      key: 'deadline',
      points: maxPoints * UNKNOWN_NEUTRAL,
      maxPoints,
      status: 'UNKNOWN',
      explanation: 'Deadline: no submission deadline published. Neutral score applied.',
    };
  }

  const threshold = minimumDaysRemaining ?? DEFAULT_MINIMUM_DAYS_REMAINING;
  const days = daysRemaining(deadlineAt, scoringTime);
  const roundedDays = Math.round(days * 10) / 10;

  if (days >= threshold * 2) {
    return {
      key: 'deadline',
      points: 5,
      maxPoints,
      status: 'MATCHED',
      explanation: `Deadline: ${roundedDays} days ≥ 2× your ${threshold}-day threshold`,
    };
  }
  if (days >= threshold * 1.5) {
    return {
      key: 'deadline',
      points: 4,
      maxPoints,
      status: 'MATCHED',
      explanation: `Deadline: ${roundedDays} days ≥ 1.5× your ${threshold}-day threshold`,
    };
  }
  if (days >= threshold) {
    return {
      key: 'deadline',
      points: 2,
      maxPoints,
      status: 'PARTIAL',
      explanation: `Deadline: ${roundedDays} days ≥ your ${threshold}-day threshold`,
    };
  }

  // Below threshold: the hard-exclusion rule fires when minimumDaysRemaining
  // is set (both values known); when unset, the spec says "0" here.
  return {
    key: 'deadline',
    points: 0,
    maxPoints,
    status: 'NO_MATCH',
    explanation: `Deadline: ${roundedDays} days is below your ${threshold}-day threshold`,
  };
}

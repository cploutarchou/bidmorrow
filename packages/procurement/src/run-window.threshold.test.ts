/**
 * Unit tests for the ADR-0008 §2 systemic-fetch-failure threshold — a pure
 * function, so tested without a database (fake-deps behavior for the D1-
 * touching consequences — checkpoint-hold on breach, budget-error
 * passthrough, render-pending exhaustion skip, drain recovery/abandonment —
 * lives in apps/worker/src/ingestion.d1.test.ts's real-D1 integration
 * suite, per this package's existing split between pure-function and
 * integration coverage, e.g. run-window.bound-issues.test.ts).
 */
import { describe, expect, it } from 'vitest';

import {
  FETCH_FAILURE_FAIL_MIN,
  FETCH_FAILURE_FAIL_RATIO,
  isFetchFailureThresholdExceeded,
} from './run-window';

describe('isFetchFailureThresholdExceeded (ADR-0008 §2)', () => {
  it('never trips below the absolute floor, even at 100% failure', () => {
    for (let failed = 0; failed < FETCH_FAILURE_FAIL_MIN; failed += 1) {
      expect(isFetchFailureThresholdExceeded(failed, failed || 1)).toBe(false);
    }
  });

  it('does not trip at exactly the ratio (strictly greater than required)', () => {
    // 5/25 = 0.2 exactly — the ADR requires STRICTLY greater than the ratio.
    expect(isFetchFailureThresholdExceeded(FETCH_FAILURE_FAIL_MIN, 25)).toBe(false);
  });

  it('trips once both the floor and the ratio are exceeded', () => {
    // 5/24 ~= 20.8% > 20%.
    expect(isFetchFailureThresholdExceeded(FETCH_FAILURE_FAIL_MIN, 24)).toBe(true);
  });

  it('trips at the ADR-documented 156-notice worked example (32nd failure)', () => {
    expect(isFetchFailureThresholdExceeded(31, 156)).toBe(false);
    expect(isFetchFailureThresholdExceeded(32, 156)).toBe(true);
  });

  it('a small window (<=4 notices) can never threshold-fail, even at 100% failure', () => {
    for (let seen = 1; seen <= 4; seen += 1) {
      expect(isFetchFailureThresholdExceeded(seen, seen)).toBe(false);
    }
  });

  it('handles noticesSeen = 0 without dividing by zero', () => {
    expect(isFetchFailureThresholdExceeded(0, 0)).toBe(false);
    expect(isFetchFailureThresholdExceeded(FETCH_FAILURE_FAIL_MIN, 0)).toBe(false);
  });

  it('constants match the ADR-0008 §2 defaults', () => {
    expect(FETCH_FAILURE_FAIL_MIN).toBe(5);
    expect(FETCH_FAILURE_FAIL_RATIO).toBe(0.2);
  });
});

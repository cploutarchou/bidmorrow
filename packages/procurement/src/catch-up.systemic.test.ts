/**
 * Unit tests for `isSystemicWindowFailure` (ADR-0009 §2) — a pure
 * classifier, so tested without a database. The drain-skip/drain-runs
 * consequences of this classification (catch-up wiring, real D1) live in
 * apps/worker/src/ingestion.d1.test.ts's integration suite, per this
 * package's existing split (e.g. run-window.threshold.test.ts).
 */
import { describe, expect, it } from 'vitest';

import { isSystemicWindowFailure } from './catch-up';

describe('isSystemicWindowFailure (ADR-0009 §2)', () => {
  it('classifies REQUEST_BUDGET_EXCEEDED as systemic', () => {
    expect(isSystemicWindowFailure('REQUEST_BUDGET_EXCEEDED')).toBe(true);
  });

  it('classifies FETCH_FAILURE_THRESHOLD_EXCEEDED as systemic', () => {
    expect(isSystemicWindowFailure('FETCH_FAILURE_THRESHOLD_EXCEEDED')).toBe(true);
  });

  it('classifies any SEARCH_FETCH_* code as systemic', () => {
    expect(isSystemicWindowFailure('SEARCH_FETCH_NETWORK_ERROR')).toBe(true);
    expect(isSystemicWindowFailure('SEARCH_FETCH_HTTP_503')).toBe(true);
  });

  it('classifies any NOTICE_FETCH_* code as systemic (defense-in-depth: a TedRequestError reaching window level)', () => {
    expect(isSystemicWindowFailure('NOTICE_FETCH_NETWORK_ERROR')).toBe(true);
    expect(isSystemicWindowFailure('NOTICE_FETCH_HTTP_404')).toBe(true);
  });

  it('classifies UNEXPECTED_WINDOW_ERROR as NOT systemic (a persistence/normalization bug says nothing about TED)', () => {
    expect(isSystemicWindowFailure('UNEXPECTED_WINDOW_ERROR')).toBe(false);
  });

  it('classifies the defense-in-depth window-level NOTICE_RENDER_PENDING as NOT systemic (origin cooperating by definition)', () => {
    expect(isSystemicWindowFailure('NOTICE_RENDER_PENDING')).toBe(false);
  });

  it('classifies null/undefined (no failure) as NOT systemic', () => {
    expect(isSystemicWindowFailure(null)).toBe(false);
    expect(isSystemicWindowFailure(undefined)).toBe(false);
  });

  it('classifies an unrecognized code as NOT systemic (fail open toward running the drain)', () => {
    expect(isSystemicWindowFailure('SOME_FUTURE_CODE')).toBe(false);
  });
});

/**
 * Unit tests for the ADR-0009 §1 render-pending taxonomy split — pure
 * functions, so tested without a database (fake-deps behavior for the
 * D1-touching consequences — counter split, no-ceiling behavior, the
 * `RENDER_PENDING_DEGRADED` diagnostic row, checkpoint-advance-on-partial —
 * lives in apps/worker/src/ingestion.d1.test.ts's real-D1 integration
 * suite, per this package's existing split between pure-function and
 * integration coverage, e.g. run-window.threshold.test.ts).
 */
import { describe, expect, it } from 'vitest';

import {
  RENDER_PENDING_DEGRADED_MIN,
  RENDER_PENDING_DEGRADED_RATIO,
  isRenderPendingDegraded,
} from './run-window';

describe('isRenderPendingDegraded (ADR-0009 §1)', () => {
  it('never fires below the absolute floor, even at 100% render-pending', () => {
    for (let pending = 0; pending < RENDER_PENDING_DEGRADED_MIN; pending += 1) {
      expect(isRenderPendingDegraded(pending, pending || 1)).toBe(false);
    }
  });

  it('does not fire at exactly the ratio (strictly greater than required)', () => {
    // 5/25 = 0.2 exactly — strictly greater than required, mirroring §2.
    expect(isRenderPendingDegraded(RENDER_PENDING_DEGRADED_MIN, 25)).toBe(false);
  });

  it('fires once both the floor and the ratio are exceeded', () => {
    // 5/24 ~= 20.8% > 20%.
    expect(isRenderPendingDegraded(RENDER_PENDING_DEGRADED_MIN, 24)).toBe(true);
  });

  it('fires at the 2026-08-20 incident shape (100% render-pending)', () => {
    // N notices, all render-pending, N >= min: 5/5 = 100% > 20%.
    expect(isRenderPendingDegraded(5, 5)).toBe(true);
    expect(isRenderPendingDegraded(156, 156)).toBe(true);
  });

  it('handles noticesSeen = 0 without dividing by zero', () => {
    expect(isRenderPendingDegraded(0, 0)).toBe(false);
    expect(isRenderPendingDegraded(RENDER_PENDING_DEGRADED_MIN, 0)).toBe(false);
  });

  it('constants match the ADR-0009 §1 initial values', () => {
    expect(RENDER_PENDING_DEGRADED_MIN).toBe(5);
    expect(RENDER_PENDING_DEGRADED_RATIO).toBe(0.2);
  });
});

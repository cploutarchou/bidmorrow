import { describe, expect, it } from 'vitest';
import { diffComponents, hasAnyMismatch, mismatchMarker } from './admin-trace';
import type { TraceComponent } from './admin-trace';

const cpv: TraceComponent = {
  key: 'cpv',
  points: 20,
  maxPoints: 20,
  status: 'MATCHED',
  explanation: 'x',
};

describe('diffComponents', () => {
  it('reports a clean match when both sides agree', () => {
    const rows = diffComponents([cpv], [cpv]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mismatch).toBe('match');
  });

  it('flags a points mismatch', () => {
    const live: TraceComponent = { ...cpv, points: 10 };
    const rows = diffComponents([cpv], [live]);
    expect(rows[0]?.mismatch).toBe('points_differ');
  });

  it('flags a status mismatch even when points happen to match', () => {
    const live: TraceComponent = { ...cpv, status: 'PARTIAL' };
    const rows = diffComponents([cpv], [live]);
    expect(rows[0]?.mismatch).toBe('status_differ');
  });

  it('flags a component missing from the live recompute', () => {
    const rows = diffComponents([cpv], []);
    expect(rows[0]?.mismatch).toBe('stored_only');
    expect(rows[0]?.live).toBeNull();
  });

  it('flags a component missing from the stored match', () => {
    const rows = diffComponents([], [cpv]);
    expect(rows[0]?.mismatch).toBe('live_only');
    expect(rows[0]?.stored).toBeNull();
  });

  it('sorts rows by key for stable rendering', () => {
    const value: TraceComponent = { ...cpv, key: 'value' };
    const buyer: TraceComponent = { ...cpv, key: 'buyer' };
    const rows = diffComponents([value, buyer], [value, buyer]);
    expect(rows.map((r) => r.key)).toEqual(['buyer', 'value']);
  });
});

describe('hasAnyMismatch', () => {
  it('is false when every row matches', () => {
    expect(hasAnyMismatch(diffComponents([cpv], [cpv]))).toBe(false);
  });

  it('is true when any row mismatches', () => {
    expect(hasAnyMismatch(diffComponents([cpv], []))).toBe(true);
  });
});

describe('mismatchMarker', () => {
  it('renders a distinct, non-color text marker for every kind', () => {
    const markers = [
      mismatchMarker('match'),
      mismatchMarker('points_differ'),
      mismatchMarker('status_differ'),
      mismatchMarker('stored_only'),
      mismatchMarker('live_only'),
    ];
    expect(new Set(markers).size).toBe(markers.length);
    for (const m of markers.slice(1)) {
      expect(m).toContain('MISMATCH');
    }
  });
});

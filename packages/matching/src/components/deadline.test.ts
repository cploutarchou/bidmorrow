import { describe, expect, it } from 'vitest';

import { scoreDeadline } from './deadline';
import { T0 } from '../test-helpers';

const DAY = 86_400_000;

describe('scoreDeadline', () => {
  it('no deadline -> UNKNOWN 2.5', () => {
    const result = scoreDeadline(null, T0, undefined);
    expect(result.points).toBe(2.5);
    expect(result.status).toBe('UNKNOWN');
  });

  it('>= 2x threshold -> 5', () => {
    const result = scoreDeadline(T0 + 34 * DAY, T0, 10);
    expect(result.points).toBe(5);
    expect(result.explanation).toContain('34 days');
    expect(result.explanation).toContain('2×');
  });

  it('exactly 2x threshold -> 5', () => {
    const result = scoreDeadline(T0 + 20 * DAY, T0, 10);
    expect(result.points).toBe(5);
  });

  it('>= 1.5x threshold -> 4', () => {
    const result = scoreDeadline(T0 + 16 * DAY, T0, 10);
    expect(result.points).toBe(4);
  });

  it('>= 1x threshold -> 2', () => {
    const result = scoreDeadline(T0 + 10 * DAY, T0, 10);
    expect(result.points).toBe(2);
  });

  it('< threshold -> 0 (hard exclusion handled separately)', () => {
    const result = scoreDeadline(T0 + 5 * DAY, T0, 10);
    expect(result.points).toBe(0);
    expect(result.status).toBe('NO_MATCH');
  });

  it('uses the default 10-day threshold when unset', () => {
    const result = scoreDeadline(T0 + 25 * DAY, T0, undefined);
    expect(result.points).toBe(5);
  });
});

import { describe, expect, it } from 'vitest';

import { classify, COMPONENT_MAX, ENGINE_VERSION, PACKAGE, UNKNOWN_NEUTRAL } from './index';
import type { MatchClassification } from './index';

describe('@bidmorrow/matching foundations', () => {
  it('pins the engine contract constants', () => {
    expect(PACKAGE).toBe('@bidmorrow/matching');
    expect(ENGINE_VERSION).toBe('1');
    expect(UNKNOWN_NEUTRAL).toBe(0.5);
  });

  it('COMPONENT_MAX matches docs/matching-engine.md and sums to exactly 100', () => {
    expect(COMPONENT_MAX).toEqual({
      cpv: 35,
      capability: 20,
      geography: 15,
      value: 10,
      buyer: 5,
      procedure: 5,
      deadline: 5,
      eligibility: 5,
    });
    const total = Object.values(COMPONENT_MAX).reduce((sum, max) => sum + max, 0);
    expect(total).toBe(100);
  });

  it.each<[number, MatchClassification]>([
    [100, 'STRONG_MATCH'],
    [80, 'STRONG_MATCH'],
    [79.5, 'WORTH_REVIEWING'],
    [65, 'WORTH_REVIEWING'],
    [64.9, 'POSSIBLE_MATCH'],
    [45, 'POSSIBLE_MATCH'],
    [44.9, 'LOW_FIT'],
    [0, 'LOW_FIT'],
  ])('classify(%s) -> %s', (score: number, expected: MatchClassification) => {
    expect(classify(score)).toBe(expected);
  });

  it('rejects scores outside [0, 100] as engine bugs', () => {
    expect(() => classify(-0.1)).toThrow(RangeError);
    expect(() => classify(100.1)).toThrow(RangeError);
    expect(() => classify(Number.NaN)).toThrow(RangeError);
  });
});

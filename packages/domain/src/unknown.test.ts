import { describe, expect, it } from 'vitest';

import { isKnown, isUnknown, unknown } from './unknown';
import type { Unknown } from './unknown';

describe('unknown()', () => {
  it('constructs an explicit unknown with its reason', () => {
    expect(unknown('value not published')).toEqual({
      kind: 'unknown',
      reason: 'value not published',
    });
  });

  it('requires a non-empty reason', () => {
    expect(() => unknown('')).toThrow(/non-empty reason/);
    expect(() => unknown('   ')).toThrow(/non-empty reason/);
  });
});

describe('isUnknown / isKnown', () => {
  it('detects unknown values and passes real values through', () => {
    const estimatedValueEur: Unknown<number> = unknown('currency not convertible');
    const knownValue: Unknown<number> = 125_000;

    expect(isUnknown(estimatedValueEur)).toBe(true);
    expect(isUnknown(knownValue)).toBe(false);
    expect(isKnown(knownValue)).toBe(true);
    expect(isKnown(estimatedValueEur)).toBe(false);
  });

  it('does not treat arbitrary objects, null, or 0 as unknown', () => {
    expect(isUnknown<{ kind: string }>({ kind: 'lot' })).toBe(false);
    expect(isUnknown<number>(0)).toBe(false);
    expect(isUnknown<string>('unknown')).toBe(false);
    expect(isUnknown<null>(null)).toBe(false);
  });

  it('narrows the type so known values are usable directly', () => {
    const deadline: Unknown<number> = 1_755_000_000_000;
    if (isKnown(deadline)) {
      // compile-time proof: arithmetic on the narrowed number
      expect(deadline + 1).toBe(1_755_000_000_001);
    } else {
      expect.unreachable('deadline should be known');
    }
  });
});

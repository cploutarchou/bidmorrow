import { describe, expect, it } from 'vitest';
import { decimalPrecision, easeOutCubic, prefersReducedMotion, roundToPrecision } from './motion';

// This project runs `apps/web/src/**/*.test.ts` under Vitest's `node`
// environment (root vitest.config.ts), not jsdom — there is no `window`
// here. `prefersReducedMotion()` exercising that exact branch is itself
// the SSR/non-browser-safety test: it must degrade to `false` (motion
// allowed) rather than throw.
describe('prefersReducedMotion', () => {
  it('degrades to false with no window (SSR / this test environment)', () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('easeOutCubic', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });
  it('clamps out-of-range progress instead of extrapolating', () => {
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(1.5)).toBe(1);
  });
  it('is monotonically increasing across the range', () => {
    const samples = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
    for (let i = 1; i < samples.length; i++) {
      expect(easeOutCubic(samples[i]!)).toBeGreaterThanOrEqual(easeOutCubic(samples[i - 1]!));
    }
  });
});

describe('decimalPrecision', () => {
  it('reads integers as zero decimals', () => {
    expect(decimalPrecision(100)).toBe(0);
    expect(decimalPrecision(0)).toBe(0);
  });
  it('counts the decimal digits of a fractional target', () => {
    expect(decimalPrecision(4.5)).toBe(1);
    expect(decimalPrecision(4.25)).toBe(2);
  });
  it('never throws on non-finite input — falls back to 0', () => {
    expect(decimalPrecision(Number.NaN)).toBe(0);
    expect(decimalPrecision(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('roundToPrecision', () => {
  it('rounds to the requested number of digits', () => {
    expect(roundToPrecision(4.567, 0)).toBe(5);
    expect(roundToPrecision(4.567, 1)).toBe(4.6);
    expect(roundToPrecision(4.567, 2)).toBe(4.57);
  });
  it('does not accumulate floating-point drift for typical UI counter values', () => {
    expect(roundToPrecision(0.1 + 0.2, 1)).toBe(0.3);
  });
});

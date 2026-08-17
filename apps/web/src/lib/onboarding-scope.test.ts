import { describe, expect, it } from 'vitest';
import { computeCpvScopeOverlap, cpvDivision } from './onboarding-scope';

describe('cpvDivision', () => {
  it('takes the first 2 digits', () => {
    expect(cpvDivision('72150000')).toBe('72');
    expect(cpvDivision('79417000')).toBe('79');
  });
});

describe('computeCpvScopeOverlap', () => {
  it('reports zero overlap honestly for an empty selection', () => {
    const result = computeCpvScopeOverlap([]);
    expect(result).toEqual({ totalCount: 0, inScopeCount: 0, hasOverlap: false });
  });

  it('reports full overlap when every code is in-scope', () => {
    const result = computeCpvScopeOverlap(['72150000', '79417000', '48000000']);
    expect(result).toEqual({ totalCount: 3, inScopeCount: 3, hasOverlap: true });
  });

  it('reports partial overlap — never rounds a real gap up to "fine"', () => {
    const result = computeCpvScopeOverlap(['72150000', '45000000']);
    expect(result).toEqual({ totalCount: 2, inScopeCount: 1, hasOverlap: true });
  });

  it('flags zero overlap when nothing in the selection is in-scope', () => {
    const result = computeCpvScopeOverlap(['45000000', '90000000']);
    expect(result).toEqual({ totalCount: 2, inScopeCount: 0, hasOverlap: false });
  });

  it('accepts a custom scope (drift-resistant for tests, not just the hardcoded default)', () => {
    const result = computeCpvScopeOverlap(['33000000'], ['33']);
    expect(result.hasOverlap).toBe(true);
  });
});

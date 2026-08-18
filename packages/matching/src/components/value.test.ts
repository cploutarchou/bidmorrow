import { describe, expect, it } from 'vitest';

import { scoreValue } from './value';
import { baseLot, baseOrg } from '../test-helpers';

describe('scoreValue', () => {
  const range = { minEur: 100_000, maxEur: 500_000 };

  it('null value -> UNKNOWN 5', () => {
    const result = scoreValue(baseLot({ valueEur: null }), baseOrg({ valueRange: range }));
    expect(result.points).toBe(5);
    expect(result.status).toBe('UNKNOWN');
  });

  it('within [min, max] -> 10', () => {
    const result = scoreValue(baseLot({ valueEur: 300_000 }), baseOrg({ valueRange: range }));
    expect(result.points).toBe(10);
    expect(result.status).toBe('MATCHED');
  });

  it('derived value within range -> 10 but PARTIAL', () => {
    const result = scoreValue(
      baseLot({ valueEur: 300_000, valueIsDerived: true }),
      baseOrg({ valueRange: range }),
    );
    expect(result.points).toBe(10);
    expect(result.status).toBe('PARTIAL');
  });

  it('50-100% of min -> 6', () => {
    const result = scoreValue(baseLot({ valueEur: 60_000 }), baseOrg({ valueRange: range }));
    expect(result.points).toBe(6);
  });

  it('25-50% of min -> 3', () => {
    const result = scoreValue(baseLot({ valueEur: 30_000 }), baseOrg({ valueRange: range }));
    expect(result.points).toBe(3);
  });

  it('below 25% of min -> 0', () => {
    const result = scoreValue(baseLot({ valueEur: 10_000 }), baseOrg({ valueRange: range }));
    expect(result.points).toBe(0);
    expect(result.status).toBe('NO_MATCH');
  });

  it('100-150% of max -> 6', () => {
    const result = scoreValue(baseLot({ valueEur: 600_000 }), baseOrg({ valueRange: range }));
    expect(result.points).toBe(6);
  });

  it('150-250% of max -> 3', () => {
    const result = scoreValue(baseLot({ valueEur: 1_000_000 }), baseOrg({ valueRange: range }));
    expect(result.points).toBe(3);
  });

  it('more than 250% of max -> 0', () => {
    const result = scoreValue(baseLot({ valueEur: 2_000_000 }), baseOrg({ valueRange: range }));
    expect(result.points).toBe(0);
  });

  it('no value preference configured -> UNKNOWN', () => {
    const result = scoreValue(baseLot({ valueEur: 100_000 }), baseOrg());
    expect(result.status).toBe('UNKNOWN');
    expect(result.points).toBe(5);
  });

  it('only min configured: value above min with no max bound -> 10', () => {
    const result = scoreValue(
      baseLot({ valueEur: 10_000_000 }),
      baseOrg({ valueRange: { minEur: 100_000 } }),
    );
    expect(result.points).toBe(10);
  });

  it('only max configured: value below max with no min bound -> 10', () => {
    const result = scoreValue(
      baseLot({ valueEur: 1 }),
      baseOrg({ valueRange: { maxEur: 500_000 } }),
    );
    expect(result.points).toBe(10);
  });
});

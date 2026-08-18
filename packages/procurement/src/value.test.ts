import { describe, expect, it } from 'vitest';
import type { NormalizedLot } from '@bidmorrow/ted';

import { deriveValueEur, divideValueAcrossLots } from './value';

function lot(overrides: Partial<NormalizedLot> = {}): NormalizedLot {
  return {
    lotId: 'LOT-0001',
    title: null,
    description: null,
    contractNature: 'services',
    estimatedValue: null,
    deadline: null,
    cpv: { main: null, additional: [] },
    nuts: [],
    ...overrides,
  };
}

describe('divideValueAcrossLots', () => {
  it('keeps a lot value when the lot publishes its own', () => {
    const lots = [lot({ estimatedValue: { amount: 100_000, currency: 'EUR' } })];
    expect(divideValueAcrossLots(lots, null)).toEqual([
      { amount: 100_000, currency: 'EUR', valueIsDerived: false },
    ]);
  });

  it('splits a procedure total equally across lots that publish none', () => {
    const lots = [lot({ lotId: 'LOT-0001' }), lot({ lotId: 'LOT-0002' })];
    const result = divideValueAcrossLots(lots, { amount: 200_000, currency: 'EUR' });
    expect(result).toEqual([
      { amount: 100_000, currency: 'EUR', valueIsDerived: true },
      { amount: 100_000, currency: 'EUR', valueIsDerived: true },
    ]);
  });

  it('only divides among lots lacking their own value, leaving the rest untouched', () => {
    const lots = [
      lot({ lotId: 'LOT-0001', estimatedValue: { amount: 50_000, currency: 'EUR' } }),
      lot({ lotId: 'LOT-0002' }),
      lot({ lotId: 'LOT-0003' }),
    ];
    const result = divideValueAcrossLots(lots, { amount: 300_000, currency: 'EUR' });
    expect(result[0]).toEqual({ amount: 50_000, currency: 'EUR', valueIsDerived: false });
    expect(result[1]).toEqual({ amount: 150_000, currency: 'EUR', valueIsDerived: true });
    expect(result[2]).toEqual({ amount: 150_000, currency: 'EUR', valueIsDerived: true });
  });

  it('leaves both fields null when neither a lot value nor a procedure total exists — never zero', () => {
    expect(divideValueAcrossLots([lot()], null)).toEqual([
      { amount: null, currency: null, valueIsDerived: false },
    ]);
  });
});

describe('deriveValueEur', () => {
  it('passes EUR amounts through', () => {
    expect(deriveValueEur(100, 'EUR')).toBe(100);
  });

  it('returns null for non-EUR currencies (conversion is a scoring-time concern)', () => {
    expect(deriveValueEur(100, 'SEK')).toBeNull();
  });

  it('returns null when either input is null', () => {
    expect(deriveValueEur(null, 'EUR')).toBeNull();
    expect(deriveValueEur(100, null)).toBeNull();
  });
});

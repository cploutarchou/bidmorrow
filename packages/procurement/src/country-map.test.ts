import { describe, expect, it } from 'vitest';

import { normalizeBuyerCountry } from './country-map';

describe('normalizeBuyerCountry', () => {
  it('maps common EU/EEA alpha-3 codes to alpha-2', () => {
    expect(normalizeBuyerCountry('FRA')).toEqual({ countryCode: 'FR', unmapped: false });
    expect(normalizeBuyerCountry('DEU')).toEqual({ countryCode: 'DE', unmapped: false });
    expect(normalizeBuyerCountry('GBR')).toEqual({ countryCode: 'GB', unmapped: false });
  });

  it('is case-insensitive on input', () => {
    expect(normalizeBuyerCountry('fra')).toEqual({ countryCode: 'FR', unmapped: false });
  });

  it('keeps an unrecognized code verbatim and flags it unmapped (never fabricates/drops)', () => {
    expect(normalizeBuyerCountry('XYZ')).toEqual({ countryCode: 'XYZ', unmapped: true });
  });

  it('passes null through', () => {
    expect(normalizeBuyerCountry(null)).toBeNull();
  });
});

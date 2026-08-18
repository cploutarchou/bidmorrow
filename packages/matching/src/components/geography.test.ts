import { describe, expect, it } from 'vitest';

import { scoreGeography } from './geography';
import { baseLot, baseOrg } from '../test-helpers';

describe('scoreGeography', () => {
  it('no NUTS/country on lot -> UNKNOWN 7.5', () => {
    const result = scoreGeography(baseLot(), baseOrg());
    expect(result.points).toBe(7.5);
    expect(result.status).toBe('UNKNOWN');
  });

  it('NUTS prefix within preferred region -> 15', () => {
    const org = baseOrg({
      geographies: { preferredNuts: ['CY'], opportunityCountries: [], countriesServed: [] },
    });
    const result = scoreGeography(baseLot({ nuts: ['CY00'], countries: ['CY'] }), org);
    expect(result.points).toBe(15);
    expect(result.status).toBe('MATCHED');
    expect(result.explanation).toContain('CY00');
  });

  it('country in preferred opportunity countries -> 13', () => {
    const org = baseOrg({
      geographies: { preferredNuts: [], opportunityCountries: ['DE'], countriesServed: [] },
    });
    const result = scoreGeography(baseLot({ countries: ['DE'] }), org);
    expect(result.points).toBe(13);
  });

  it('country in countries served -> 10', () => {
    const org = baseOrg({
      geographies: { preferredNuts: [], opportunityCountries: [], countriesServed: ['FR'] },
    });
    const result = scoreGeography(baseLot({ countries: ['FR'] }), org);
    expect(result.points).toBe(10);
  });

  it('neighboring country of a preferred country -> 6', () => {
    const org = baseOrg({
      geographies: { preferredNuts: [], opportunityCountries: ['FR'], countriesServed: [] },
    });
    // BE neighbors FR
    const result = scoreGeography(baseLot({ countries: ['BE'] }), org);
    expect(result.points).toBe(6);
    expect(result.status).toBe('PARTIAL');
  });

  it('no relationship -> 0', () => {
    const org = baseOrg({
      geographies: { preferredNuts: [], opportunityCountries: ['FR'], countriesServed: [] },
    });
    const result = scoreGeography(baseLot({ countries: ['JP'] }), org);
    expect(result.points).toBe(0);
    expect(result.status).toBe('NO_MATCH');
  });

  it('NUTS takes priority over country-level match', () => {
    const org = baseOrg({
      geographies: { preferredNuts: ['CY30'], opportunityCountries: ['CY'], countriesServed: [] },
    });
    const result = scoreGeography(baseLot({ nuts: ['CY30A'], countries: ['CY'] }), org);
    expect(result.points).toBe(15);
  });
});

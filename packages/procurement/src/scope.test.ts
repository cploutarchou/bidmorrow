import { describe, expect, it } from 'vitest';

import { DEFAULT_INGESTION_SCOPE, buildScopeQuery, parseIngestionScope } from './scope';

describe('buildScopeQuery', () => {
  it('composes family-root CPV wildcards, the competition filter, and the publication-date window', () => {
    const query = buildScopeQuery(DEFAULT_INGESTION_SCOPE, {
      windowFrom: '2026-08-10',
      windowTo: '2026-08-10',
    });
    expect(query).toBe(
      'classification-cpv IN (72*, 48*, 79417000) AND form-type = competition AND publication-date >= 2026-08-10 AND publication-date <= 2026-08-10 SORT BY publication-date',
    );
  });

  it('appends a buyer-country filter only when countries are configured', () => {
    const withCountries = buildScopeQuery(
      { cpvFamilies: ['72'], countries: ['FR', 'DE'] },
      { windowFrom: '2026-08-10', windowTo: '2026-08-11' },
    );
    expect(withCountries).toContain('buyer-country IN (FR, DE)');

    const withoutCountries = buildScopeQuery(
      { cpvFamilies: ['72'], countries: [] },
      { windowFrom: '2026-08-10', windowTo: '2026-08-11' },
    );
    expect(withoutCountries).not.toContain('buyer-country');
  });

  it('treats a full 8-digit CPV code as exact, not a wildcard', () => {
    const query = buildScopeQuery(
      { cpvFamilies: ['79417000'], countries: [] },
      { windowFrom: '2026-01-01', windowTo: '2026-01-01' },
    );
    expect(query).toContain('classification-cpv IN (79417000)');
    expect(query).not.toContain('79417000*');
  });
});

describe('parseIngestionScope', () => {
  it('parses a valid flag value', () => {
    const scope = parseIngestionScope('{"cpvFamilies":["72","48"],"countries":["FR"]}');
    expect(scope).toEqual({ cpvFamilies: ['72', '48'], countries: ['FR'] });
  });

  it('defaults countries to empty when omitted', () => {
    expect(parseIngestionScope('{"cpvFamilies":["72"]}')).toEqual({
      cpvFamilies: ['72'],
      countries: [],
    });
  });

  it('rejects an empty cpvFamilies array (never silently ingest unscoped)', () => {
    expect(() => parseIngestionScope('{"cpvFamilies":[]}')).toThrow();
  });

  it('rejects a malformed shape', () => {
    expect(() => parseIngestionScope('"not-an-object"')).toThrow();
    expect(() => parseIngestionScope('{"cpvFamilies":[1,2]}')).toThrow();
  });
});

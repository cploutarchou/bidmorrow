import { describe, expect, it } from 'vitest';

import { PACKAGE, TED_API_BASE, TED_SOURCE_ID } from './index';
import type { TedSearchRequest } from './index';

describe('@bidmorrow/ted skeleton', () => {
  it('exports stable source constants', () => {
    expect(PACKAGE).toBe('@bidmorrow/ted');
    expect(TED_SOURCE_ID).toBe('ted');
    expect(TED_API_BASE).toBe('https://api.ted.europa.eu');
  });

  it('TED_API_BASE is an https origin without a trailing slash', () => {
    // Endpoint paths like /v3/notices/search are appended to it in Phase 5.
    expect(TED_API_BASE.startsWith('https://')).toBe(true);
    expect(TED_API_BASE.endsWith('/')).toBe(false);
  });

  it('TedSearchRequest mirrors the documented POST /v3/notices/search body', () => {
    const request: TedSearchRequest = {
      query: '(classification-cpv IN (72)) AND form-type = competition SORT BY publication-date',
      fields: ['publication-number', 'publication-date', 'notice-title', 'links'],
      limit: 250,
      scope: 'LATEST',
      paginationMode: 'ITERATION',
      iterationNextToken: 'token-from-previous-page',
    };
    // Documented cap: len(fields) × limit ≤ 10,000 fields per page.
    expect(request.fields.length * (request.limit ?? 0)).toBeLessThanOrEqual(10_000);

    // @ts-expect-error — query is required by the Search API
    const _missingQuery: TedSearchRequest = { fields: ['publication-number'] };

    const pageMode: TedSearchRequest = {
      query: 'buyer-country=FRA',
      fields: ['publication-number'],
      page: 1,
      paginationMode: 'PAGE_NUMBER',
    };
    expect(pageMode.page).toBe(1);
  });
});

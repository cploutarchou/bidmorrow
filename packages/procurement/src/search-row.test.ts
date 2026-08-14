import { describe, expect, it } from 'vitest';

import { extractSearchRow } from './search-row';

describe('extractSearchRow', () => {
  it('extracts sourceNoticeId, publicationDate, and the xml.MUL link', () => {
    const row = {
      'publication-number': '12345-2026',
      'publication-date': '2026-08-10+02:00',
      links: { xml: { MUL: 'https://ted.europa.eu/notice/12345-2026.xml' } },
    };
    expect(extractSearchRow(row)).toEqual({
      sourceNoticeId: '12345-2026',
      publicationDate: '2026-08-10',
      xmlUrl: 'https://ted.europa.eu/notice/12345-2026.xml',
    });
  });

  it('returns null (never throws, never fabricates) when a required field is missing', () => {
    expect(extractSearchRow({ 'publication-date': '2026-08-10' })).toBeNull();
    expect(
      extractSearchRow({ 'publication-number': '1', 'publication-date': '2026-08-10' }),
    ).toBeNull();
    expect(
      extractSearchRow({
        'publication-number': '1',
        'publication-date': '2026-08-10',
        links: { xml: {} },
      }),
    ).toBeNull();
  });
});

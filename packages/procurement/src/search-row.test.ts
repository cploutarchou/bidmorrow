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

describe('extractSearchRow: publication-number validation (SEC-P5-02)', () => {
  const row = (sourceNoticeId: string) => ({
    'publication-number': sourceNoticeId,
    'publication-date': '2026-08-10',
    links: { xml: { MUL: 'https://ted.europa.eu/notice/x.xml' } },
  });

  it('accepts the documented TED format (tier 1)', () => {
    expect(extractSearchRow(row('123-2026'))?.sourceNoticeId).toBe('123-2026');
  });

  it('rejects a tier-1-shaped value carrying a path separator', () => {
    // Would look like tier 1 with a trailing segment — must not slip through
    // as an R2 key path component (packages/procurement/src/snapshot.ts).
    expect(extractSearchRow(row('123-2026/2'))).toBeNull();
  });

  it('rejects an over-length junk id that fails both tiers', () => {
    expect(extractSearchRow(row('x'.repeat(65)))).toBeNull();
  });

  it('accepts the demo seed id format via the tier-2 conservative charset', () => {
    // scripts/seed-demo.sql uses TED-DEMO-001 / TED-DEMO-002.
    expect(extractSearchRow(row('TED-DEMO-001'))?.sourceNoticeId).toBe('TED-DEMO-001');
  });

  it('rejects a value with no path-unsafe characters but outside both tiers (e.g. containing a slash)', () => {
    expect(extractSearchRow(row('abc/def'))).toBeNull();
  });
});

describe('extractSearchRow: xml URL length cap (BM-51-1)', () => {
  const rowWithUrl = (xmlUrl: string) => ({
    'publication-number': '123-2026',
    'publication-date': '2026-08-10',
    links: { xml: { MUL: xmlUrl } },
  });

  it('accepts a realistic-length URL', () => {
    const url = `https://ted.europa.eu/en/notice/123-2026/xml`;
    expect(extractSearchRow(rowWithUrl(url))?.xmlUrl).toBe(url);
  });

  it('rejects an oversized URL as a malformed row — window rows are buffered in memory', () => {
    const url = `https://ted.europa.eu/${'a'.repeat(2_100)}`;
    expect(extractSearchRow(rowWithUrl(url))).toBeNull();
  });
});

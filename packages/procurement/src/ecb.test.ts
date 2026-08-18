import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { EcbFetchError, EcbParseError, fetchEcbRates, parseEcbDailyXml } from './ecb';
import type { EcbFetchResponse } from './ecb';

const FIXTURES = new URL('../../../tests/fixtures/ecb/', import.meta.url);

function loadFixture(relativePath: string): string {
  return readFileSync(new URL(relativePath, FIXTURES), 'utf8');
}

describe('parseEcbDailyXml', () => {
  it('parses the real feed shape (documented format fixture) into rateDate + rates', () => {
    const xml = loadFixture('eurofxref-daily.xml');
    const parsed = parseEcbDailyXml(xml);

    expect(parsed.rateDate).toBe('2026-08-14');
    expect(parsed.rates.length).toBe(17);

    const usd = parsed.rates.find((r) => r.currency === 'USD');
    expect(usd).toBeDefined();
    // Feed publishes units-per-EUR (1.0850 USD = 1 EUR); stored value is the inverse.
    expect(usd?.rateToEur).toBeCloseTo(1 / 1.085, 10);

    const sek = parsed.rates.find((r) => r.currency === 'SEK');
    expect(sek?.rateToEur).toBeCloseTo(1 / 11.2345, 10);
  });

  it('every parsed rate is a valid ISO-4217 code with a positive finite rateToEur', () => {
    const xml = loadFixture('eurofxref-daily.xml');
    const parsed = parseEcbDailyXml(xml);
    for (const rate of parsed.rates) {
      expect(rate.currency).toMatch(/^[A-Z]{3}$/);
      expect(Number.isFinite(rate.rateToEur)).toBe(true);
      expect(rate.rateToEur).toBeGreaterThan(0);
    }
  });

  it('throws EcbParseError on structurally invalid XML (wrong root element)', () => {
    expect(() => parseEcbDailyXml('<not-an-envelope/>')).toThrow(EcbParseError);
  });

  it('throws EcbParseError when XML does not parse at all', () => {
    expect(() => parseEcbDailyXml('<Envelope><unterminated')).toThrow(EcbParseError);
  });

  it('throws EcbParseError on a zero/negative rate (never stored, would poison scoring)', () => {
    const poisoned = `<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
      <Cube><Cube time="2026-08-14"><Cube currency="USD" rate="0"/></Cube></Cube>
    </gesmes:Envelope>`;
    expect(() => parseEcbDailyXml(poisoned)).toThrow(EcbParseError);
  });
});

describe('fetchEcbRates', () => {
  it('parses a successful injected-fetch response', async () => {
    const xml = loadFixture('eurofxref-daily.xml');
    const fetchImpl = async (): Promise<EcbFetchResponse> => ({
      ok: true,
      status: 200,
      text: async () => xml,
    });
    const result = await fetchEcbRates({ fetch: fetchImpl });
    expect(result.rateDate).toBe('2026-08-14');
    expect(result.rates.length).toBe(17);
  });

  it('throws EcbFetchError on a non-ok HTTP response', async () => {
    const fetchImpl = async (): Promise<EcbFetchResponse> => ({
      ok: false,
      status: 403,
      text: async () => '',
    });
    await expect(fetchEcbRates({ fetch: fetchImpl })).rejects.toThrow(EcbFetchError);
  });

  it('throws EcbFetchError when the fetch itself rejects (network/proxy blocked)', async () => {
    const fetchImpl = async (): Promise<EcbFetchResponse> => {
      throw new Error('CONNECT tunnel failed, response 403');
    };
    await expect(fetchEcbRates({ fetch: fetchImpl })).rejects.toThrow(EcbFetchError);
  });
});

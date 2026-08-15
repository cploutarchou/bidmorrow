/**
 * ECB euro foreign exchange reference rates (ADR-0004): daily fetch + parse
 * of the published `eurofxref-daily.xml` feed, upserted into `exchange_rates`
 * via `@bidmorrow/db`'s ops-global repository.
 *
 * Parser choice: `fast-xml-parser` is added directly as a dependency here
 * rather than reusing `@bidmorrow/ted`'s `parser/xml.ts` helpers — that
 * module is an internal implementation detail of the `ted` package (not part
 * of its public `index.ts` exports), and `procurement` must not depend on
 * another feature package's internals. The underlying library is already a
 * pinned, vetted workspace dependency (docs/dependency-versions.md), so
 * adding it directly avoids both a forbidden internal coupling and a
 * duplicated hand-rolled XML parser.
 *
 * Reachability: ecb.europa.eu is proxy-blocked from this dev environment
 * (same honesty pattern as TED in Phase 5 — verified via a direct fetch
 * attempt, `CONNECT tunnel failed, response 403`). `fetchEcbRates` is
 * exercised only against the stored fixture
 * (tests/fixtures/ecb/eurofxref-daily.xml, built from the documented feed
 * shape) until it can be proven against the live feed on staging.
 */
import { XMLParser } from 'fast-xml-parser';
import type { Logger } from '@bidmorrow/observability';
import type { Db } from '@bidmorrow/db';
import { upsertRates } from '@bidmorrow/db';

/** The ECB's daily reference-rate feed — published once/day, ~16:00 CET, business days only. */
export const ECB_DAILY_XML_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

export class EcbFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcbFetchError';
  }
}

export class EcbParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcbParseError';
  }
}

/** Minimal fetch-response shape this module needs (test seam matches `@bidmorrow/ted`'s injected-fetch pattern). */
export interface EcbFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type EcbFetch = (url: string) => Promise<EcbFetchResponse>;

export interface ParsedEcbRate {
  /** ISO-4217 code. */
  readonly currency: string;
  /** Multiplier converting one unit of `currency` into EUR (the inverse of the ECB-published currency-per-EUR quote). */
  readonly rateToEur: number;
}

export interface ParsedEcbRates {
  /** `YYYY-MM-DD` ECB reference date. */
  readonly rateDate: string;
  readonly rates: readonly ParsedEcbRate[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

type XmlNode = Record<string, unknown>;

function asArray(value: unknown): XmlNode[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item): item is XmlNode => typeof item === 'object' && item !== null);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Parses the daily feed's `gesmes:Envelope > Cube > Cube[@time] >
 * Cube[@currency,@rate]` shape into `{rateDate, rates}`. Pure — no I/O.
 * Structurally invalid input (wrong element, missing date, non-numeric
 * rates) throws `EcbParseError` rather than silently producing partial or
 * corrupt rate data; a rate of 0/negative/non-finite is dropped with a
 * thrown error rather than ever being stored (would poison scoring).
 */
export function parseEcbDailyXml(xml: string): ParsedEcbRates {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (cause) {
    throw new EcbParseError(
      `ECB feed XML did not parse: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (typeof doc !== 'object' || doc === null) {
    throw new EcbParseError('ECB feed did not parse to a document');
  }
  const envelope = (doc as XmlNode).Envelope;
  if (typeof envelope !== 'object' || envelope === null) {
    throw new EcbParseError('ECB feed missing root <Envelope> element');
  }
  const outerCube = asArray((envelope as XmlNode).Cube)[0];
  if (outerCube === undefined) {
    throw new EcbParseError('ECB feed missing outer <Cube> element');
  }
  const datedCube = asArray(outerCube.Cube)[0];
  if (datedCube === undefined) {
    throw new EcbParseError('ECB feed missing dated <Cube time="..."> element');
  }
  const rateDate = datedCube['@_time'];
  if (typeof rateDate !== 'string' || !ISO_DATE_RE.test(rateDate)) {
    throw new EcbParseError(`ECB feed dated <Cube> has an invalid or missing time attribute`);
  }

  const currencyCubes = asArray(datedCube.Cube);
  if (currencyCubes.length === 0) {
    throw new EcbParseError('ECB feed dated <Cube> has no currency rows');
  }

  const rates: ParsedEcbRate[] = [];
  for (const cube of currencyCubes) {
    const currency = cube['@_currency'];
    const rateAttr = cube['@_rate'];
    if (typeof currency !== 'string' || !CURRENCY_RE.test(currency)) {
      throw new EcbParseError(
        `ECB feed currency Cube has an invalid currency code: ${String(currency)}`,
      );
    }
    if (typeof rateAttr !== 'string') {
      throw new EcbParseError(`ECB feed currency Cube ${currency} is missing a rate attribute`);
    }
    const unitsPerEur = Number(rateAttr);
    if (!Number.isFinite(unitsPerEur) || unitsPerEur <= 0) {
      throw new EcbParseError(
        `ECB feed currency Cube ${currency} has a non-positive/invalid rate: ${rateAttr}`,
      );
    }
    // The feed publishes "units of currency per 1 EUR"; exchange_rates
    // stores the inverse (EUR per unit of currency) per docs/data-model.md.
    rates.push({ currency, rateToEur: 1 / unitsPerEur });
  }

  return { rateDate, rates };
}

/** Fetches and parses the live ECB daily feed. Throws `EcbFetchError`/`EcbParseError` — never swallows a failure. */
export async function fetchEcbRates(deps: { readonly fetch: EcbFetch }): Promise<ParsedEcbRates> {
  let response: EcbFetchResponse;
  try {
    response = await deps.fetch(ECB_DAILY_XML_URL);
  } catch (cause) {
    throw new EcbFetchError(
      `ECB feed request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!response.ok) {
    throw new EcbFetchError(`ECB feed returned HTTP ${String(response.status)}`);
  }
  const xml = await response.text();
  return parseEcbDailyXml(xml);
}

export interface RefreshEcbRatesResult {
  readonly rateDate: string;
  readonly ratesWritten: number;
}

/**
 * Daily refresh entry point, wired ahead of scoring in the ingestion cron
 * path. Non-fatal on failure: a missed/blocked ECB fetch does not fail
 * ingestion — value-fit scoring degrades to UNKNOWN for stale/absent
 * currencies (ADR-0004), which is the documented, safe fallback. The
 * failure is still logged loudly so staleness is visible operationally.
 */
export async function refreshEcbRates(deps: {
  readonly db: Db;
  readonly fetch: EcbFetch;
  readonly logger: Logger;
}): Promise<RefreshEcbRatesResult | null> {
  let parsed: ParsedEcbRates;
  try {
    parsed = await fetchEcbRates(deps);
  } catch (cause) {
    deps.logger.error('ecb.refresh.failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
  const ratesWritten = await upsertRates(deps.db, {
    rateDate: parsed.rateDate,
    rates: parsed.rates,
  });
  deps.logger.info('ecb.refresh.completed', {
    rate_date: parsed.rateDate,
    rates_written: ratesWritten,
  });
  return { rateDate: parsed.rateDate, ratesWritten };
}

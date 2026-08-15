/**
 * ISO-3166-1 alpha-3 → alpha-2 buyer-country normalization.
 *
 * eForms notices carry the buyer country as alpha-3 (BT-514); the tender
 * corpus stores alpha-2 (docs/data-model.md §3 `buyers.country_code`).
 * Covers the EU/EEA member states (the only publication countries in
 * scope, docs/ted-ingestion-scope.md) plus the UK (still present in the TED
 * historical corpus). Anything else is NOT silently dropped: the original
 * code is kept verbatim and a warning is surfaced to the caller.
 */

const ALPHA3_TO_ALPHA2: Readonly<Record<string, string>> = {
  AUT: 'AT',
  BEL: 'BE',
  BGR: 'BG',
  HRV: 'HR',
  CYP: 'CY',
  CZE: 'CZ',
  DNK: 'DK',
  EST: 'EE',
  FIN: 'FI',
  FRA: 'FR',
  DEU: 'DE',
  GRC: 'GR',
  HUN: 'HU',
  ISL: 'IS',
  IRL: 'IE',
  ITA: 'IT',
  LVA: 'LV',
  LIE: 'LI',
  LTU: 'LT',
  LUX: 'LU',
  MLT: 'MT',
  NLD: 'NL',
  NOR: 'NO',
  POL: 'PL',
  PRT: 'PT',
  ROU: 'RO',
  SVK: 'SK',
  SVN: 'SI',
  ESP: 'ES',
  SWE: 'SE',
  GBR: 'GB',
};

export interface NormalizedCountry {
  readonly countryCode: string;
  /** True when the alpha-3 code was NOT recognized and kept verbatim. */
  readonly unmapped: boolean;
}

/**
 * Maps a source-native alpha-3 country code to alpha-2. Unknown codes are
 * kept verbatim (never fabricated/dropped) with `unmapped: true` so the
 * caller can log a warning; null input passes through as null.
 */
export function normalizeBuyerCountry(alpha3: string | null): NormalizedCountry | null {
  if (alpha3 === null) {
    return null;
  }
  const mapped = ALPHA3_TO_ALPHA2[alpha3.toUpperCase()];
  if (mapped !== undefined) {
    return { countryCode: mapped, unmapped: false };
  }
  return { countryCode: alpha3, unmapped: true };
}

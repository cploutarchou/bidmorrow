/**
 * Two small shape helpers shared by the ingestion path and the sample-verdict
 * mapper.
 *
 * They live here rather than inside `run-window.ts` so that anything needing
 * to reproduce a scored lot — notably `notice-lot-input.ts`, which the public
 * demo's verdicts are generated from — uses the same rules the real pipeline
 * uses instead of a lookalike. A second copy of `nutsToCountry` in particular
 * would be easy to get subtly wrong and hard to notice.
 */

/**
 * The language variant ingestion stores for a title/description.
 *
 * eForms carries every language variant; `lots.title` is a single column, so
 * ingestion keeps the FIRST variant and records the notice's language list
 * separately. Scoring then keys that text by the notice's primary language.
 */
export function firstLanguageValue(map: Readonly<Record<string, string>> | null): string | null {
  if (map === null) {
    return null;
  }
  const first = Object.values(map)[0];
  return first ?? null;
}

/** NUTS codes are country-prefixed (first 2 letters); falls back to the buyer country when a NUTS code is too short to trust. */
export function nutsToCountry(nuts: string, buyerCountry: { countryCode: string } | null): string {
  const prefix = nuts.slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(prefix) ? prefix : (buyerCountry?.countryCode ?? prefix);
}

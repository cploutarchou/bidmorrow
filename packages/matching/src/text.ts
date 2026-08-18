/**
 * Shared, deterministic text-normalization helpers used by the capability,
 * exclusion-phrase, and risk-flag matchers. No stemming, no locale-specific
 * casing — determinism beats recall in V1 (docs/matching-engine.md).
 */

/** Case-fold + strip combining diacritics (NFD, drop combining marks). */
export function foldText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * True when `needle` (a single word or a multi-word phrase) occurs in
 * `haystack` as a whole-word/whole-phrase match, both diacritic-folded and
 * case-insensitive. Word boundaries are Unicode-letter/number boundaries so
 * folded text still matches correctly.
 */
export function containsWholeTerm(haystack: string, needle: string): boolean {
  const foldedHaystack = foldText(haystack);
  const foldedNeedle = foldText(needle).trim();
  if (foldedNeedle.length === 0) {
    return false;
  }
  const escaped = escapeRegExp(foldedNeedle).replace(/\s+/g, '\\s+');
  // Anchored word-boundary via lookaround on alphanumerics — bounded,
  // non-backtracking pattern (ReDoS-safe: no nested quantifiers).
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
  return pattern.test(foldedHaystack);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `term` is a multi-word phrase (>= 2 words). */
export function isPhrase(term: string): boolean {
  return term.trim().split(/\s+/).filter(Boolean).length >= 2;
}

/**
 * Concatenate all values of a language-text map, in a deterministic
 * (sorted-key) order, restricted to the given matchable language set. Empty
 * string when no matchable language is present.
 */
export function matchableCorpus(
  textByLang: Readonly<Record<string, string>>,
  matchableLanguages: ReadonlySet<string>,
): string {
  const keys = Object.keys(textByLang)
    .filter((lang) => matchableLanguages.has(lang.toLowerCase()))
    .sort();
  return keys.map((lang) => textByLang[lang]).join('\n');
}

/** Input length cap applied before any regex scan (ReDoS/DoS defense-in-depth). */
export const MAX_SCAN_CHARS = 20_000;

export function capForScan(input: string): string {
  return input.length > MAX_SCAN_CHARS ? input.slice(0, MAX_SCAN_CHARS) : input;
}

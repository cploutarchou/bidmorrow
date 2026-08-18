/**
 * Pure, framework-free ranking/filtering logic for the accessible combobox
 * (`components/Combobox.tsx`) — extracted so it is unit-testable under this
 * repo's node-only Vitest project (no jsdom, see root `vitest.config.ts`),
 * and so the exact same ranking contract can later back a remote/async
 * source without the component itself changing.
 *
 * Ranking contract: prefix matches (on the committed `value` or any
 * whitespace-delimited word of the display `label`) sort before
 * substring-only matches; within each tier, results are ordered by `value`
 * using a numeric-aware compare (so CPV codes like "72200000"/"72212000"
 * sort as numbers, not lexicographically) — "code/alpha order" per the
 * combobox spec.
 */

export interface ComboboxOption {
  /** Value committed to the caller's state (e.g. a CPV code, ISO-3166-1
   * alpha-2 country code, or a free-form keyword term). Used as the React
   * list key and as one of the two matched fields. */
  readonly value: string;
  /** Primary display text shown in the popup and read as the option's
   * accessible name. */
  readonly label: string;
  /** Optional secondary display text (e.g. a country's ISO code shown next
   * to its name). Display-only — never matched against. */
  readonly sublabel?: string;
}

/** Bounded result-list length — the popup never renders an unranked wall of options. */
export const DEFAULT_RESULT_LIMIT = 8;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function isPrefixMatch(option: ComboboxOption, query: string): boolean {
  if (option.value.toLowerCase().startsWith(query)) return true;
  const label = option.label.toLowerCase();
  if (label.startsWith(query)) return true;
  return label.split(/\s+/).some((word) => word.startsWith(query));
}

function isSubstringMatch(option: ComboboxOption, query: string): boolean {
  return option.value.toLowerCase().includes(query) || option.label.toLowerCase().includes(query);
}

function byValue<T extends ComboboxOption>(a: T, b: T): number {
  return a.value.localeCompare(b.value, undefined, { numeric: true });
}

/**
 * Ranks `options` against `query`. An empty (or whitespace-only) query
 * returns the first `limit` options in their given order — a "browse" state
 * for an about-to-be-focused/just-opened popup, never treated as "no
 * results". A non-empty query with zero matches returns an empty array; the
 * component renders the empty state for that.
 */
export function rankComboboxOptions<T extends ComboboxOption>(
  query: string,
  options: readonly T[],
  limit: number = DEFAULT_RESULT_LIMIT,
): readonly T[] {
  const q = normalizeQuery(query);
  if (q.length === 0) return options.slice(0, limit);

  const prefix: T[] = [];
  const substring: T[] = [];
  for (const option of options) {
    if (!isSubstringMatch(option, q)) continue;
    if (isPrefixMatch(option, q)) prefix.push(option);
    else substring.push(option);
  }
  prefix.sort(byValue);
  substring.sort(byValue);
  return [...prefix, ...substring].slice(0, limit);
}

/**
 * Async-capable source contract the `Combobox` component consumes: local
 * static datasets and a future remote/API-backed dataset implement the
 * exact same shape, so the component's sequence-guard + `AbortSignal`
 * handling (stale-result protection) works identically for both — no
 * component change needed to plug in a real API later.
 */
export type ComboboxSource<T extends ComboboxOption = ComboboxOption> = (
  query: string,
  signal?: AbortSignal,
) => Promise<readonly T[]>;

/**
 * Wraps a static, local, public dataset as a `ComboboxSource`. Ranks
 * synchronously and resolves immediately — no network, and deliberately no
 * artificial debounce/setTimeout latency (there is nothing to debounce
 * against for in-memory data).
 */
export function localComboboxSource<T extends ComboboxOption>(
  options: readonly T[],
  limit: number = DEFAULT_RESULT_LIMIT,
): ComboboxSource<T> {
  return (query: string) => Promise.resolve(rankComboboxOptions(query, options, limit));
}

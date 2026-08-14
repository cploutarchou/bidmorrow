/**
 * @bidmorrow/ted — ProcurementSource implementation for TED.
 *
 * Phase 2 skeleton: the HTTP client and the eForms parser arrive in Phase 5.
 * This module pins the source identity and the Search API request shape per
 * docs/ted-data-source.md (verified 2026-08-14). No fetch logic yet.
 */

export const PACKAGE = '@bidmorrow/ted';

/** Stable source id used for checkpoints, runs, and provenance rows. */
export const TED_SOURCE_ID = 'ted';

/** Default TED API base URL (config-overridable in Phase 5). */
export const TED_API_BASE = 'https://api.ted.europa.eu';

/** Notice version scope of a search. */
export type TedSearchScope = 'LATEST' | 'ACTIVE' | 'ALL';

/**
 * PAGE_NUMBER is stateless but capped at 15,000 notices per query;
 * ITERATION (point-in-time scroll token, valid >= 24 h) has no cap and is
 * what ingestion uses within a bounded daily window.
 */
export type TedPaginationMode = 'PAGE_NUMBER' | 'ITERATION';

/**
 * Body of `POST /v3/notices/search` (anonymous endpoint).
 * Caps: `limit` <= 250 and `fields.length * limit` <= 10,000.
 */
export interface TedSearchRequest {
  /** Expert query string, e.g. `buyer-country=FRA AND form-type = competition`. */
  query: string;
  /** eForms BT ids (`BT-21-Lot`) or kebab-case aliases (`publication-number`). */
  fields: readonly string[];
  /** 1-based page number (PAGE_NUMBER mode). */
  page?: number;
  /** Notices per page, max 250. */
  limit?: number;
  scope?: TedSearchScope;
  paginationMode?: TedPaginationMode;
  /** Scroll token returned by the previous ITERATION-mode response. */
  iterationNextToken?: string;
}

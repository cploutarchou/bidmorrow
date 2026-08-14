/**
 * @bidmorrow/ted — TED Search API client + eForms notice parser.
 *
 * Source identity and Search API request shape per docs/ted-data-source.md
 * (verified 2026-08-14). Phase 5 stage A: `TedClient` (polite, budgeted
 * HTTP) and `parseEformsNotice` (eForms XML → NormalizedNotice). Stage B
 * (packages/procurement) composes them into the ProcurementSource
 * `fetchWindow` pipeline — this package stays pure (no db dependency).
 */

export * from './errors';
export * from './client';
export * from './parser/parse-notice';
export { MAX_TEXT_LENGTH } from './parser/xml';

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

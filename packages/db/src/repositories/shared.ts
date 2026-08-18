/**
 * Cross-repository helpers: pagination normalization, opaque cursors, and
 * statement chunking for D1's bound-parameter limit.
 *
 * Pagination convention (repository contract): every list function takes
 * `{ limit?, cursor? }`, clamps limit to [1, 100] with default 25, orders
 * deterministically, and returns `{ items, nextCursor }` where `nextCursor`
 * is null on the last page.
 */

import type { BatchItem } from 'drizzle-orm/batch';

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

/** Standard pagination arguments accepted by every list function. */
export interface Pagination {
  /** Page size; clamped to [1, 100], default 25. */
  limit?: number;
  /** Opaque cursor from the previous page's `nextCursor`; omit for page 1. */
  cursor?: string;
}

/** A page of rows plus the cursor for the next page (null = last page). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Clamps a requested page size into [1, MAX_PAGE_LIMIT], defaulting to 25. */
export function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Builds a page from rows fetched with `limit + 1`: the extra row only
 * signals that a next page exists and is dropped from the result.
 */
export function toPage<T>(rows: T[], limit: number, cursorOf: (last: T) => string): Page<T> {
  if (rows.length <= limit) {
    return { items: rows, nextCursor: null };
  }
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  // items.length === limit >= 1, so last is always present.
  return { items, nextCursor: last === undefined ? null : cursorOf(last) };
}

/**
 * Splits rows into insert-sized chunks. D1 caps bound parameters per
 * statement (see https://developers.cloudflare.com/d1/platform/limits/), so
 * multi-row inserts are chunked to `floor(90 / columnCount)` rows each — a
 * deliberately conservative budget of at most 90 parameters per statement.
 */
export function chunkForInsert<T>(rows: T[], columnCount: number): T[][] {
  const size = Math.max(1, Math.floor(90 / columnCount));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/** A statement runnable inside `db.batch` (one atomic D1 transaction). */
export type SqliteBatchItem = BatchItem<'sqlite'>;

/**
 * Narrows a dynamically built statement list to the non-empty tuple type
 * `db.batch` requires. Throws on an empty list — an empty batch is always a
 * caller bug.
 */
export function toBatch(statements: SqliteBatchItem[]): [SqliteBatchItem, ...SqliteBatchItem[]] {
  if (statements.length === 0) {
    throw new Error('toBatch: refusing to run an empty batch');
  }
  return statements as [SqliteBatchItem, ...SqliteBatchItem[]];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Asserts a `YYYY-MM-DD` calendar-date string (docs/data-model.md
 * Conventions). Repositories compare `*_date` columns lexicographically, so
 * a malformed date silently breaks window filters and the ingestion
 * checkpoint advance-only rule — reject it loudly instead. Returns the value
 * for inline use.
 */
export function assertIsoDate(value: string, label: string): string {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD date, got "${value}"`);
  }
  return value;
}

const MS_PER_DAY = 86_400_000;

/** UTC `YYYY-MM-DD` of `epochMs` shifted back by `days` whole days. */
export function isoDateDaysBefore(epochMs: number, days: number): string {
  return new Date(epochMs - days * MS_PER_DAY).toISOString().slice(0, 10);
}

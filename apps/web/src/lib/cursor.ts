/**
 * Cursor-pagination merge helper for "load more" lists (feed, presets are
 * unpaginated but tender lists are unbounded per docs/product-scope.md).
 * Pure so it can be unit tested without a component/DOM harness.
 */
export interface CursorPage<T> {
  items: readonly T[];
  nextCursor: string | null;
}

export interface CursorState<T> {
  items: readonly T[];
  nextCursor: string | null;
}

/** Starts a fresh cursor state from the first page (e.g. after a filter change). */
export function startCursor<T>(page: CursorPage<T>): CursorState<T> {
  return { items: page.items, nextCursor: page.nextCursor };
}

/** Appends a subsequent "load more" page onto existing state. */
export function appendCursor<T>(state: CursorState<T>, page: CursorPage<T>): CursorState<T> {
  return { items: [...state.items, ...page.items], nextCursor: page.nextCursor };
}

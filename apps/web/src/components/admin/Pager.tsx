import type { ReactElement } from 'react';

/** Shared "load more" pagination control for admin list tables (cursor-based, ≤50/page server-side). */
export function Pager({
  nextCursor,
  loading,
  onLoadMore,
}: {
  nextCursor: string | null;
  loading: boolean;
  onLoadMore: () => void;
}): ReactElement | null {
  if (nextCursor === null) return null;
  return (
    <button type="button" onClick={onLoadMore} disabled={loading}>
      {loading ? 'Loading…' : 'Load more'}
    </button>
  );
}

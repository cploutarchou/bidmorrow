/**
 * The Feed's `?view=` query parameter, which makes the score-band and shelf
 * views linkable (header "Saved" link, bookmarks, digest deep-links; see
 * docs/redesign/navigation-and-admin-entry.md §2). Anything unknown falls
 * back to the default view rather than erroring: a stale link must never
 * break the feed.
 */
export const FEED_VIEWS = [
  'today',
  'strong',
  'worth_reviewing',
  'possible',
  'saved',
  'ignored',
] as const;

export type FeedView = (typeof FEED_VIEWS)[number];

export const DEFAULT_FEED_VIEW: FeedView = 'today';

export function isFeedView(value: string): value is FeedView {
  return (FEED_VIEWS as readonly string[]).includes(value);
}

export function parseFeedView(value: string | null | undefined): FeedView {
  if (value === null || value === undefined) return DEFAULT_FEED_VIEW;
  const trimmed = value.trim();
  return isFeedView(trimmed) ? trimmed : DEFAULT_FEED_VIEW;
}

/** Path for the Feed showing `view`; the default view keeps a clean `/app`. */
export function feedPathForView(view: FeedView): string {
  return view === DEFAULT_FEED_VIEW ? '/app' : `/app?view=${view}`;
}

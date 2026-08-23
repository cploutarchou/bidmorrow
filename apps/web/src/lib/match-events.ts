/**
 * Save/ignore changes made in one place, applied everywhere that shows the
 * same match.
 *
 * Before the detail sheet, this was not needed: opening a tender navigated
 * away from the feed, and coming back remounted `Feed`, which refetched. The
 * sheet deliberately keeps the feed mounted underneath, so a save made in the
 * sheet would leave the card behind it showing the old state until something
 * else forced a reload.
 *
 * A refetch on close would fix that too, but it costs a request per close and
 * can reorder or drop the row the user was just looking at. This publishes the
 * one field that actually changed instead.
 *
 * Deliberately not a store: there is no shared state to own here, only an
 * event. Subscribers keep their own copies and patch them.
 */

export interface MatchUpdate {
  readonly matchId: string;
  /** Omitted when this update did not touch the flag. */
  readonly savedByYou?: boolean;
  readonly ignoredByYou?: boolean;
}

type Listener = (update: MatchUpdate) => void;

const listeners = new Set<Listener>();

export function publishMatchUpdate(update: MatchUpdate): void {
  // Copied before iterating: a listener that unsubscribes itself while the
  // set is being walked would otherwise skip the next one.
  for (const listener of [...listeners]) listener(update);
}

/** Returns the unsubscribe function, so callers can pass it straight to `useEffect`. */
export function subscribeToMatchUpdates(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

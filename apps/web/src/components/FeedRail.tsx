import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import {
  createSavedSearch,
  deleteSavedSearch,
  DuplicateSavedSearchName,
  listSavedSearches,
  type SavedSearch,
  type SavedSearchTab,
} from '../lib/saved-searches';

/**
 * The feed's left rail — 2026-08-21 handoff (`BidMorrow Client Area.dc.html`).
 *
 * Saved searches turn the filter bar from something retyped every morning
 * into a named thing the whole workspace can re-apply.
 *
 * Two blocks in the design are NOT reproduced, because both would have meant
 * inventing numbers:
 *
 * - The per-search and per-shelf hit counts ("18", "6 new"). Nothing counts
 *   those today, and a count is exactly the kind of figure a person acts on;
 *   a plausible-looking wrong one is worse than none.
 * - The "Shelves" block itself. Saved and Ignored are already two of the
 *   feed's own tabs, so repeating them in the rail would be a second control
 *   for the same thing — and without counts it would add nothing at all.
 * - The "78% complete — add 2 references" profile meter. There is no
 *   completeness model in the product, so the summary states what the
 *   profile actually contains and links to Settings instead.
 */
export function FeedRail({
  activeTab,
  activeFilters,
  hasActiveFilters,
  onApply,
  profileSummary,
}: {
  activeTab: SavedSearchTab;
  activeFilters: Record<string, string>;
  hasActiveFilters: boolean;
  onApply: (search: SavedSearch) => void;
  /** Real values only — omitted entirely when the profile has not loaded. */
  profileSummary: string | null;
}): ReactElement {
  const [searches, setSearches] = useState<SavedSearch[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSavedSearches()
      .then((items) => {
        if (!cancelled) setSearches(items);
      })
      .catch(() => {
        // The rail is an accelerator, not the feed. If it cannot load, the
        // feed must still work, so this degrades to an empty rail rather
        // than surfacing an error over the results.
        if (!cancelled) setSearches([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createSavedSearch({
        name: trimmed,
        tab: activeTab,
        filters: activeFilters,
      });
      setSearches((prev) =>
        [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setName('');
      setNaming(false);
    } catch (cause) {
      setError(
        cause instanceof DuplicateSavedSearchName
          ? 'You already have a saved search with that name.'
          : 'Could not save this search — please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(search: SavedSearch): Promise<void> {
    setError(null);
    const previous = searches ?? [];
    setSearches(previous.filter((s) => s.id !== search.id));
    try {
      await deleteSavedSearch(search.id);
    } catch {
      setSearches(previous);
      setError('Could not delete that saved search.');
    }
  }

  const items = searches ?? [];

  return (
    <aside className="feed-rail" aria-label="Saved searches and shelves">
      <section className="feed-rail__block">
        <div className="feed-rail__head">
          <h2 className="feed-rail__title">Saved searches</h2>
          <button
            type="button"
            className="btn-ghost--sm"
            aria-expanded={naming}
            disabled={!hasActiveFilters && !naming}
            title={
              hasActiveFilters
                ? undefined
                : 'Set at least one filter before saving this as a search'
            }
            onClick={() => {
              setError(null);
              setNaming((v) => !v);
            }}
          >
            + New
          </button>
        </div>

        {naming && (
          <form
            className="feed-rail__form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label htmlFor="saved-search-name">Name this search</label>
            <input
              id="saved-search-name"
              value={name}
              maxLength={80}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
            <button
              className="cta btn-sm"
              type="submit"
              disabled={busy || name.trim().length === 0}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}

        {error !== null && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        {searches === null ? (
          <p className="hint">Loading…</p>
        ) : items.length === 0 ? (
          <p className="hint">
            Filter the feed, then save it here to come back to the same view tomorrow.
          </p>
        ) : (
          <ul className="feed-rail__list">
            {items.map((search) => (
              <li key={search.id}>
                <button
                  type="button"
                  className="feed-rail__item"
                  aria-current={appliedId === search.id ? 'true' : undefined}
                  onClick={() => {
                    setAppliedId(search.id);
                    onApply(search);
                  }}
                >
                  {search.name}
                </button>
                <button
                  type="button"
                  className="feed-rail__remove"
                  aria-label={`Delete saved search ${search.name}`}
                  onClick={() => void remove(search)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {profileSummary !== null && (
        <section className="feed-rail__block">
          <h2 className="feed-rail__title">Matching profile</h2>
          <p className="feed-rail__profile">{profileSummary}</p>
          <Link to="/app/settings" className="btn-ghost--sm">
            Tune it
          </Link>
        </section>
      )}
    </aside>
  );
}
